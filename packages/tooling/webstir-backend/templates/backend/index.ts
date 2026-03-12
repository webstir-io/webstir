import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { Logger } from 'pino';

import { loadEnv, type AppEnv } from './env.js';
import { resolveRequestAuth, type AuthContext } from './auth/adapter.js';
import { createBaseLogger, createRequestLogger } from './observability/logger.js';
import { createMetricsTracker, type MetricsTracker } from './observability/metrics.js';
import {
  executeRequestHookPhase,
  resolveRequestHooks,
  type CompiledRequestHook,
  type RequestHookDefinitionLike,
  type RequestHookHandler,
  type RequestHookReferenceLike
} from './runtime/request-hooks.js';
import {
  parseCookieHeader,
  prepareSessionState,
  type PreparedSessionState,
  type SessionAwareRouteDefinitionLike,
  type SessionFlashMessage
} from './runtime/session.js';

interface EnvAccessor {
  get(name: string): string | undefined;
  require(name: string): string;
  entries(): Record<string, string | undefined>;
}

type RouteHandlerResult = {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  redirect?: {
    location: string;
  };
  fragment?: {
    target: string;
    selector?: string;
    mode?: 'replace' | 'append' | 'prepend';
    body: unknown;
  };
  errors?: { code: string; message: string; details?: unknown }[];
};

type NormalizedRouteHandlerResult = RouteHandlerResult & {
  fragment?: {
    target: string;
    selector?: string;
    mode?: 'replace' | 'append' | 'prepend';
    body: unknown;
  };
};

interface RouteContext {
  request: http.IncomingMessage;
  reply: http.ServerResponse;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  auth: AuthContext | undefined;
  session: Record<string, unknown> | null;
  flash: SessionFlashMessage[];
  db: Record<string, unknown>;
  env: EnvAccessor;
  logger: Logger;
  requestId: string;
  now: () => Date;
}

type RouteHandler = (ctx: RouteContext) => Promise<RouteHandlerResult> | RouteHandlerResult;

interface ModuleRouteDefinition extends SessionAwareRouteDefinitionLike {
  name?: string;
  method?: string;
  path?: string;
  requestHooks?: RequestHookReferenceLike[];
  interaction?: 'navigation' | 'mutation';
  form?: SessionAwareRouteDefinitionLike['form'] & {
    contentType?: 'application/x-www-form-urlencoded' | 'multipart/form-data' | 'text/plain';
    csrf?: boolean;
  };
  fragment?: {
    target: string;
    selector?: string;
    mode?: 'replace' | 'append' | 'prepend';
  };
}

interface ModuleRoute {
  definition?: ModuleRouteDefinition;
  handler?: RouteHandler;
}

interface ModuleManifestLike {
  name?: string;
  version?: string;
  capabilities?: string[];
  requestHooks?: RequestHookDefinitionLike[];
  routes?: ModuleRouteDefinition[];
}

type LifecycleHook = (context: { env: EnvAccessor; logger: Logger }) => Promise<void> | void;

interface ModuleRequestHook {
  id?: string;
  handler?: RequestHookHandler<RouteContext, RouteHandlerResult, ModuleRouteDefinition>;
}

interface ModuleDefinitionLike {
  manifest?: ModuleManifestLike;
  routes?: ModuleRoute[];
  requestHooks?: ModuleRequestHook[];
  init?: LifecycleHook;
  dispose?: LifecycleHook;
}

interface CompiledRoute {
  method: string;
  name: string;
  match: (pathname: string) => { matched: boolean; params: Record<string, string> };
  handler: RouteHandler;
  requestHooks: CompiledRequestHook<RouteContext, RouteHandlerResult, ModuleRouteDefinition>[];
  definition?: ModuleRouteDefinition;
}

interface ModuleRuntime {
  definition?: ModuleDefinitionLike;
  manifest?: ModuleManifestLike;
  routes: CompiledRoute[];
  source?: string;
  warnings?: string[];
}

type ReadinessStatus = 'booting' | 'ready' | 'error';

interface ReadinessState {
  status: ReadinessStatus;
  message?: string;
}

type ReadinessTracker = ReturnType<typeof createReadinessTracker>;

interface ManifestSummary {
  name?: string;
  version?: string;
  routes: number;
  capabilities?: string[];
}

export async function start(): Promise<void> {
  const env = loadEnv();
  const logger = createBaseLogger(env);
  const metrics = createMetricsTracker(env.metrics);
  const readiness = createReadinessTracker();
  readiness.booting();

  let runtime: ModuleRuntime;
  let loadError: string | undefined;

  try {
    runtime = await loadModuleRuntime();
  } catch (error) {
    loadError = (error as Error).message ?? 'Failed to load module definition';
    logger.error({ err: error }, '[webstir-backend] module load failed');
    readiness.error(loadError);
    runtime = { routes: [] };
  }

  if (runtime.source) {
    logger.info(`[webstir-backend] loaded module definition from ${runtime.source}`);
  } else {
    logger.warn('[webstir-backend] no module definition found. Add src/backend/module.ts to describe routes.');
  }

  logManifestSummary(logger, runtime.manifest, runtime.routes.length);
  for (const warning of runtime.warnings ?? []) {
    logger.warn({ warning }, '[webstir-backend] request hook configuration warning');
  }
  const manifestSummary = summarizeManifest(runtime.manifest);

  const server = http.createServer((req, res) => {
    void handleRequest({ req, res, runtime, readiness, manifestSummary, env, logger, metrics });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.PORT, '0.0.0.0', () => resolve());
  });

  if (!loadError) {
    readiness.ready();
  }

  logger.info({ port: env.PORT, mode: env.NODE_ENV }, 'API server running');
}

async function handleRequest(options: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  runtime: ModuleRuntime;
  readiness: ReadinessTracker;
  env: AppEnv;
  logger: Logger;
  metrics: MetricsTracker;
  manifestSummary?: ManifestSummary;
}): Promise<void> {
  const { req, res, runtime, readiness, manifestSummary, env, logger, metrics } = options;
  try {
    if (!req.url) {
      respondJson(res, 400, { error: 'bad_request' });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const pathname = normalizePath(url.pathname);
    const method = (req.method ?? 'GET').toUpperCase();

    if (isHealthPath(pathname)) {
      respondJson(res, 200, { ok: true, uptime: process.uptime() });
      return;
    }

    if (isReadyPath(pathname)) {
      const snapshot = readiness.snapshot();
      const statusCode = snapshot.status === 'ready' ? 200 : 503;
      respondJson(res, statusCode, {
        status: snapshot.status,
        message: snapshot.message,
        manifest: manifestSummary,
        metrics: metrics.snapshot()
      });
      return;
    }

    if (isMetricsPath(pathname)) {
      const snapshot = metrics.snapshot();
      respondJson(res, 200, snapshot ?? { enabled: false });
      return;
    }

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? 'content-type');
      res.end('');
      return;
    }

    const matched = matchRoute(runtime.routes, method, pathname);
    if (!matched) {
      respondJson(res, 404, { error: 'not_found', path: pathname });
      metrics.record({ method, route: pathname, status: 404, durationMs: 0 });
      return;
    }

    const routeName = matched.route.name ?? matched.route.definition?.path ?? pathname;
    const startTime = process.hrtime.bigint();
    const body = await readRequestBody(req);
    const requestId = extractRequestId(req);
    res.setHeader('x-request-id', requestId);

    const requestLogger = createRequestLogger(logger, { requestId, req, route: routeName });
    const envAccessor = createEnvAccessor();
    const db: Record<string, unknown> = Object.create(null);
    const now = () => new Date();
    const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
      cookies: parseCookieHeader(req.headers.cookie),
      route: matched.route.definition,
      config: env.sessions,
      now
    });
    const ctx: RouteContext = {
      request: req,
      reply: res,
      params: matched.params,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      auth: undefined,
      session: sessionState.session,
      flash: sessionState.flash,
      db,
      env: envAccessor,
      logger: requestLogger,
      requestId,
      now
    };

    let handlerFailed = false;
    try {
      const beforeAuth = await executeRequestHookPhase({
        hooks: matched.route.requestHooks,
        phase: 'beforeAuth',
        context: ctx,
        route: matched.route.definition ?? { name: matched.route.name, path: pathname, method },
        logger: requestLogger
      });
      if (beforeAuth.shortCircuited && beforeAuth.result) {
        sendCommittedRouteResponse(res, beforeAuth.result, {
          sessionState,
          session: ctx.session,
          route: matched.route.definition
        });
        return;
      }

      if (ctx.auth === undefined) {
        ctx.auth = resolveRequestAuth(req, env.auth, requestLogger);
      }

      const beforeHandler = await executeRequestHookPhase({
        hooks: matched.route.requestHooks,
        phase: 'beforeHandler',
        context: ctx,
        route: matched.route.definition ?? { name: matched.route.name, path: pathname, method },
        logger: requestLogger
      });
      if (beforeHandler.shortCircuited && beforeHandler.result) {
        sendCommittedRouteResponse(res, beforeHandler.result, {
          sessionState,
          session: ctx.session,
          route: matched.route.definition
        });
        return;
      }

      const handlerResult = await matched.route.handler(ctx);
      const afterHandler = await executeRequestHookPhase({
        hooks: matched.route.requestHooks,
        phase: 'afterHandler',
        context: ctx,
        route: matched.route.definition ?? { name: matched.route.name, path: pathname, method },
        logger: requestLogger,
        result: handlerResult
      });
      sendCommittedRouteResponse(res, afterHandler.result ?? handlerResult, {
        sessionState,
        session: ctx.session,
        route: matched.route.definition
      });
    } catch (error) {
      handlerFailed = true;
      requestLogger.error({ err: error }, 'route handler failed');
      throw error;
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
      const statusCode = handlerFailed ? 500 : res.statusCode ?? 200;
      metrics.record({ method, route: routeName, status: statusCode, durationMs });
      requestLogger.info({ status: statusCode, durationMs }, 'request.completed');
    }
  } catch (error) {
    logger.error({ err: error }, '[webstir-backend] request failed');
    if (!res.headersSent) {
      respondJson(res, 500, { error: 'internal_error', message: (error as Error).message });
    } else {
      res.end();
    }
  }
}

function sendCommittedRouteResponse(
  res: http.ServerResponse,
  result: RouteHandlerResult,
  options: {
    sessionState: PreparedSessionState<Record<string, unknown>, RouteHandlerResult>;
    session: Record<string, unknown> | null;
    route?: ModuleRouteDefinition;
  }
): void {
  const normalizedResult = normalizeRouteHandlerResult(result);
  const commit = options.sessionState.commit({
    session: options.session,
    route: options.route,
    result: normalizedResult
  });
  sendRouteResponse(res, normalizedResult, commit.setCookie);
}

function sendRouteResponse(
  res: http.ServerResponse,
  result: NormalizedRouteHandlerResult,
  setCookie?: string
): void {
  const status = resolveResponseStatus(result);
  const headers = resolveResponseHeaders(result);
  res.statusCode = status;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'set-cookie') {
      appendSetCookieHeader(res, value);
      continue;
    }
    res.setHeader(key, value);
  }
  if (setCookie) {
    appendSetCookieHeader(res, setCookie);
  }

  if (result.errors) {
    respondJson(res, status, { errors: result.errors });
    return;
  }

  if (result.redirect) {
    res.end('');
    return;
  }

  const payload = result.fragment ? result.fragment.body : result.body;

  if (payload === undefined || payload === null) {
    res.end('');
    return;
  }

  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    res.end(payload);
    return;
  }

  respondJson(res, status, payload);
}

function resolveResponseStatus(result: NormalizedRouteHandlerResult): number {
  if (result.redirect) {
    return result.status ?? 303;
  }
  return result.status ?? (result.errors ? 400 : 200);
}

function resolveResponseHeaders(result: NormalizedRouteHandlerResult): Record<string, string> {
  const headers: Record<string, string> = { ...(result.headers ?? {}) };

  if (result.redirect) {
    headers.location = result.redirect.location;
  }

  if (result.fragment) {
    headers['x-webstir-fragment-target'] = result.fragment.target;
    if (result.fragment.selector) {
      headers['x-webstir-fragment-selector'] = result.fragment.selector;
    }
    if (result.fragment.mode) {
      headers['x-webstir-fragment-mode'] = result.fragment.mode;
    }
  }

  if (!('content-type' in lowerCaseHeaderMap(headers))) {
    const payload = result.fragment ? result.fragment.body : result.body;
    if (payload === undefined || payload === null) {
      return headers;
    }
    headers['content-type'] = resolveContentType(payload);
  }

  return headers;
}

function normalizeRouteHandlerResult(result: RouteHandlerResult): NormalizedRouteHandlerResult {
  const validatedFragment = validateFragmentResult(result.fragment);
  if (!validatedFragment.valid) {
    return {
      status: result.status && result.status >= 400 ? result.status : 500,
      headers: result.headers,
      errors: [
        {
          code: 'invalid_fragment_response',
          message: 'Fragment responses require a non-empty target, supported mode, and body.',
          details: validatedFragment.issues
        }
      ]
    };
  }

  if (!validatedFragment.fragment) {
    return result;
  }

  return {
    ...result,
    fragment: validatedFragment.fragment
  };
}

function validateFragmentResult(fragment: RouteHandlerResult['fragment']):
  | { valid: true; fragment?: NormalizedRouteHandlerResult['fragment'] }
  | { valid: false; issues: string[] } {
  if (!fragment) {
    return { valid: true };
  }

  const issues: string[] = [];
  const target = typeof fragment.target === 'string' ? fragment.target.trim() : '';
  if (!target) {
    issues.push('target');
  }

  let selector: string | undefined;
  if (fragment.selector !== undefined) {
    if (typeof fragment.selector !== 'string' || !fragment.selector.trim()) {
      issues.push('selector');
    } else {
      selector = fragment.selector.trim();
    }
  }

  let mode: 'replace' | 'append' | 'prepend' | undefined;
  if (fragment.mode !== undefined) {
    if (fragment.mode === 'replace' || fragment.mode === 'append' || fragment.mode === 'prepend') {
      mode = fragment.mode;
    } else {
      issues.push('mode');
    }
  }

  if (fragment.body === undefined || fragment.body === null) {
    issues.push('body');
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    fragment: {
      target,
      selector,
      mode,
      body: fragment.body
    }
  };
}

function appendSetCookieHeader(res: http.ServerResponse, value: string): void {
  const existing = res.getHeader('set-cookie');
  if (!existing) {
    res.setHeader('set-cookie', value);
    return;
  }
  const values = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  values.push(value);
  res.setHeader('set-cookie', values);
}

function lowerCaseHeaderMap(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function resolveContentType(payload: unknown): string {
  if (typeof payload === 'string') {
    return 'text/html; charset=utf-8';
  }
  if (Buffer.isBuffer(payload)) {
    return 'application/octet-stream';
  }
  return 'application/json';
}

function createEnvAccessor(): EnvAccessor {
  return {
    get: (name) => process.env[name],
    require: (name) => {
      const value = process.env[name];
      if (value === undefined) {
        throw new Error(`Missing required env var ${name}`);
      }
      return value;
    },
    entries: () => ({ ...process.env })
  };
}

function extractRequestId(req: http.IncomingMessage): string {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  if (Array.isArray(header) && header.length > 0) {
    return header[0];
  }
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}`;
  }
}

function createReadinessTracker() {
  let status: ReadinessStatus = 'booting';
  let message: string | undefined;

  return {
    booting() {
      status = 'booting';
      message = undefined;
    },
    ready() {
      status = 'ready';
      message = undefined;
    },
    error(reason: string) {
      status = 'error';
      message = reason;
    },
    snapshot(): ReadinessState {
      return { status, message };
    }
  };
}

function isHealthPath(pathname: string): boolean {
  return pathname === '/api/health' || pathname === '/healthz';
}

function isReadyPath(pathname: string): boolean {
  return pathname === '/readyz';
}

function isMetricsPath(pathname: string): boolean {
  return pathname === '/metrics';
}

function respondJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (!res.headersSent) {
    if (!res.hasHeader('content-type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.statusCode = status;
  }
  res.end(JSON.stringify(payload));
}

function matchRoute(routes: CompiledRoute[], method: string, pathname: string): { route: CompiledRoute; params: Record<string, string> } | undefined {
  const normalizedMethod = (method ?? 'GET').toUpperCase();
  for (const route of routes) {
    if (route.method !== normalizedMethod) continue;
    const { matched, params } = route.match(pathname);
    if (matched) {
      return { route, params };
    }
  }
  return undefined;
}

async function loadModuleRuntime(): Promise<ModuleRuntime> {
  const loaded = await tryLoadModuleDefinition();
  if (!loaded) {
    return { routes: [] };
  }
  const manifest = sanitizeManifest(loaded.definition.manifest);
  const compiled = compileRoutes(loaded.definition.routes ?? [], {
    manifestRequestHooks: manifest?.requestHooks,
    requestHookImplementations: loaded.definition.requestHooks
  });
  return {
    definition: loaded.definition,
    manifest,
    routes: compiled.routes,
    source: loaded.source,
    warnings: compiled.warnings
  };
}

function sanitizeManifest(manifest?: ModuleManifestLike): ModuleManifestLike | undefined {
  if (!manifest || typeof manifest !== 'object') {
    return undefined;
  }
  return {
    ...manifest,
    routes: Array.isArray(manifest.routes) ? manifest.routes : [],
    requestHooks: Array.isArray(manifest.requestHooks) ? manifest.requestHooks : [],
    capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : undefined
  };
}

function summarizeManifest(manifest?: ModuleManifestLike): ManifestSummary | undefined {
  if (!manifest) {
    return undefined;
  }
  return {
    name: manifest.name,
    version: manifest.version,
    routes: Array.isArray(manifest.routes) ? manifest.routes.length : 0,
    capabilities: manifest.capabilities && manifest.capabilities.length > 0 ? manifest.capabilities : undefined
  };
}

function logManifestSummary(logger: Logger, manifest: ModuleManifestLike | undefined, routeCount: number): void {
  if (!manifest) {
    logger.info(`[webstir-backend] manifest routes=${routeCount} (no manifest metadata found)`);
    return;
  }
  const caps = manifest.capabilities?.length ? ` [${manifest.capabilities.join(', ')}]` : '';
  const routes = Array.isArray(manifest.routes) ? manifest.routes.length : routeCount;
  logger.info(`[webstir-backend] manifest name=${manifest.name ?? 'unknown'} routes=${routes}${caps}`);
}

function compileRoutes(
  routes: ModuleRoute[],
  options: {
    manifestRequestHooks?: RequestHookDefinitionLike[];
    requestHookImplementations?: ModuleRequestHook[];
  }
): { routes: CompiledRoute[]; warnings: string[] } {
  const compiled: CompiledRoute[] = [];
  const warnings: string[] = [];
  for (const route of routes) {
    if (typeof route.handler !== 'function') {
      continue;
    }
    const method = (route.definition?.method ?? 'GET').toUpperCase();
    const pathPattern = normalizePath(route.definition?.path ?? '/');
    const routeName = route.definition?.name ?? pathPattern;
    const resolvedHooks = resolveRequestHooks<RouteContext, RouteHandlerResult, ModuleRouteDefinition>({
      routeName,
      routeReferences: route.definition?.requestHooks,
      manifestDefinitions: options.manifestRequestHooks,
      registrations: options.requestHookImplementations,
    });
    compiled.push({
      method,
      name: routeName,
      match: createPathMatcher(pathPattern),
      handler: route.handler,
      requestHooks: resolvedHooks.hooks,
      definition: route.definition
    });
    warnings.push(...resolvedHooks.warnings);
  }
  return { routes: compiled, warnings };
}

function createPathMatcher(pattern: string) {
  const normalized = normalizePath(pattern);
  const paramRegex = /:([A-Za-z0-9_]+)/g;
  const regex = new RegExp(
    '^' +
      normalized
        .replace(/\//g, '\\/')
        .replace(paramRegex, (_segment, name) => `(?<${name}>[^/]+)`) +
      '$'
  );
  return (pathname: string) => {
    const pathToTest = normalizePath(pathname);
    const match = regex.exec(pathToTest);
    if (!match) {
      return { matched: false, params: {} };
    }
    const params = (match.groups ?? {}) as Record<string, string>;
    return { matched: true, params };
  };
}

async function tryLoadModuleDefinition(): Promise<{ definition: ModuleDefinitionLike; source: string } | undefined> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = ['module.js', 'module.mjs', 'module/index.js', 'module/index.mjs'];
  for (const rel of candidates) {
    const full = path.join(here, rel);
    try {
      const imported = await import(`${pathToFileURL(full).href}?t=${Date.now()}`);
      const definition = extractModuleDefinition(imported);
      if (definition) {
        return { definition, source: rel };
      }
    } catch {
      // ignore and continue
    }
  }
  return undefined;
}

function extractModuleDefinition(exports: Record<string, unknown>): ModuleDefinitionLike | undefined {
  const keys = ['module', 'moduleDefinition', 'default', 'backendModule'];
  for (const key of keys) {
    if (key in exports) {
      const value = exports[key as keyof typeof exports];
      if (value && typeof value === 'object') {
        return value as ModuleDefinitionLike;
      }
    }
  }
  return undefined;
}

async function readRequestBody(req: http.IncomingMessage): Promise<unknown> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const buffer = Buffer.concat(chunks);
  const contentType = String(req.headers['content-type'] ?? '');
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(buffer.toString('utf8'));
    } catch {
      return undefined;
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return parseFormEncodedBody(buffer.toString('utf8'));
  }
  if (contentType.includes('text/plain')) {
    return buffer.toString('utf8');
  }
  return buffer.toString('utf8');
}

function parseFormEncodedBody(input: string): Record<string, string | string[]> {
  const entries = new URLSearchParams(input);
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of entries) {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
      continue;
    }
    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }
    result[key] = [existing, value];
  }
  return result;
}

function normalizePath(value: string | undefined): string {
  if (!value || value === '/') return '/';
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

const isMain = (() => {
  try {
    const argv1 = process.argv?.[1];
    if (!argv1) return false;
    const here = new URL(import.meta.url);
    const run = new URL(`file://${argv1}`);
    return here.pathname === run.pathname;
  } catch {
    return false;
  }
})();

if (isMain) {
  start().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
