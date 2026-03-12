// Optional Fastify server scaffold for richer routing
// Rename or import into your backend index to use.
import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';

import { loadEnv } from '../env.js';
import { resolveRequestAuth } from '../auth/adapter.js';
import {
  executeRequestHookPhase,
  resolveRequestHooks,
  type RequestHookDefinitionLike,
  type RequestHookHandler,
  type RequestHookReferenceLike
} from '../runtime/request-hooks.js';
import {
  parseCookieHeader,
  prepareSessionState,
  type PreparedSessionState,
  type SessionAwareRouteDefinitionLike,
  type SessionFlashMessage
} from '../runtime/session.js';
import {
  compileViews,
  matchView,
  renderRequestTimeView,
  toHeaderRecord,
  type CompiledView,
  type ModuleViewLike,
  type ViewDefinitionLike
} from '../runtime/views.js';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  readonly level: LogLevel;
  log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void;
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  with(bindings: Record<string, unknown>): Logger;
}

interface EnvAccessor {
  get(name: string): string | undefined;
  require(name: string): string;
  entries(): Record<string, string | undefined>;
}

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

interface RouteContext extends Record<string, unknown> {
  request: import('fastify').FastifyRequest;
  reply: import('fastify').FastifyReply;
  auth: unknown;
  session: Record<string, unknown> | null;
  flash: SessionFlashMessage[];
  db: Record<string, unknown>;
  env: EnvAccessor;
  logger: Logger;
  requestId: string;
  now: () => Date;
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
}

interface ModuleRoute {
  definition?: ModuleRouteDefinition;
  handler?: (ctx: RouteContext) => Promise<RouteHandlerResult> | RouteHandlerResult;
}

interface ModuleViewDefinition extends ViewDefinitionLike {}

interface ModuleView extends ModuleViewLike {}

interface ModuleManifestLike {
  name?: string;
  version?: string;
  capabilities?: string[];
  requestHooks?: RequestHookDefinitionLike[];
  routes?: ModuleRouteDefinition[];
  views?: ModuleViewDefinition[];
}

interface ModuleRequestHook {
  id?: string;
  handler?: RequestHookHandler<RouteContext, RouteHandlerResult, ModuleRouteDefinition>;
}

interface ModuleDefinitionLike {
  manifest?: ModuleManifestLike;
  routes?: ModuleRoute[];
  views?: ModuleView[];
  requestHooks?: ModuleRequestHook[];
}

interface RouteHandlerResult {
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
}

type NormalizedRouteHandlerResult = RouteHandlerResult & {
  fragment?: {
    target: string;
    selector?: string;
    mode?: 'replace' | 'append' | 'prepend';
    body: unknown;
  };
};

interface ManifestSummary {
  name?: string;
  version?: string;
  routes: number;
  views: number;
  capabilities?: string[];
}

type ReadinessStatus = 'booting' | 'ready' | 'error';
type ReadinessTracker = ReturnType<typeof createReadinessTracker>;

export async function start(): Promise<void> {
  const env = loadEnv();
  const port = env.PORT;
  const mode = env.NODE_ENV;
  const readiness = createReadinessTracker();
  readiness.booting();

  const app = Fastify({ logger: false });
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, parseFormEncodedBody(body));
    } catch (error) {
      done(error as Error);
    }
  });
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }));
  app.get('/healthz', async () => ({ ok: true }));

  let manifestSummary: ManifestSummary | undefined;
  let compiledViews: CompiledView[] = [];

  app.get('/readyz', async (_req, reply) => {
    const snapshot = readiness.snapshot();
    const statusCode = snapshot.status === 'ready' ? 200 : 503;
    reply.code(statusCode);
    return { status: snapshot.status, message: snapshot.message, manifest: manifestSummary };
  });

  try {
    const definition = await tryLoadModuleDefinition();
    if (definition) {
      compiledViews = compileViews(resolveModuleViews(definition));
      manifestSummary = summarizeManifest(definition.manifest, definition.routes, compiledViews);
      logManifestSummary(definition.manifest, definition.routes, compiledViews);
      mountRoutes(app, definition, env.auth, env.sessions);
    } else {
      console.info('[fastify] no module definition found. Routes will be empty.');
    }
  } catch (error) {
    readiness.error((error as Error).message ?? 'module load failed');
    console.error('[fastify] failed to load module definition:', error);
  }

  configureViewNotFoundHandler(app, compiledViews, env.auth, env.sessions);

  await app.listen({ port, host: '0.0.0.0' });

  if (readiness.snapshot().status !== 'error') {
    readiness.ready();
  }

  // Dev runner watches for this readiness line
  console.info('API server running');
  console.info(`[webstir-backend] mode=${mode} port=${port}`);
}

function mountRoutes(
  app: import('fastify').FastifyInstance,
  definition: ModuleDefinitionLike,
  authSecrets: ReturnType<typeof loadEnv>['auth'],
  sessionConfig: ReturnType<typeof loadEnv>['sessions']
) {
  const routes = Array.isArray(definition?.routes) ? definition.routes : [];
  const manifestHooks = Array.isArray(definition.manifest?.requestHooks) ? definition.manifest.requestHooks : [];
  const requestHookImplementations = Array.isArray(definition.requestHooks) ? definition.requestHooks : [];
  for (const r of routes) {
    try {
      const method = String(r.definition?.method ?? 'GET').toUpperCase();
      const url = String(r.definition?.path ?? '/');
      const routeName = String(r.definition?.name ?? url);
      const handler = r.handler;
      if (typeof handler !== 'function') continue;
      const resolvedHooks = resolveRequestHooks<RouteContext, RouteHandlerResult, ModuleRouteDefinition>({
        routeName,
        routeReferences: r.definition?.requestHooks,
        manifestDefinitions: manifestHooks,
        registrations: requestHookImplementations
      });
      for (const warning of resolvedHooks.warnings) {
        console.warn('[fastify] request hook configuration warning', warning);
      }

      app.route({
        method: method as any,
        url,
        handler: async (req, reply) => {
          const requestId = extractRequestId(req);
          reply.header('x-request-id', requestId);
          const envAccessor = createEnvAccessor();
          const requestLogger = createRequestLogger(requestId).with({ route: routeName });
          const now = () => new Date();
          const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
            cookies: parseCookieHeader(req.headers.cookie as string | string[] | undefined),
            route: r.definition,
            config: sessionConfig,
            now
          });
          const ctx: RouteContext = {
            request: req,
            reply,
            auth: undefined,
            session: sessionState.session,
            flash: sessionState.flash,
            db: {},
            env: envAccessor,
            logger: requestLogger,
            requestId,
            now,
            params: (req as any).params ?? {},
            query: (req as any).query ?? {},
            body: (req as any).body ?? {}
          };
          try {
            const routeDefinition = r.definition ?? { name: routeName, method, path: url };
            const beforeAuth = await executeRequestHookPhase({
              hooks: resolvedHooks.hooks,
              phase: 'beforeAuth',
              context: ctx,
              route: routeDefinition,
              logger: requestLogger
            });
            if (beforeAuth.shortCircuited && beforeAuth.result) {
              sendCommittedRouteResponse(reply, beforeAuth.result, {
                sessionState,
                session: ctx.session,
                route: routeDefinition
              });
              return;
            }

            if (ctx.auth === undefined) {
              ctx.auth = resolveRequestAuth(req.raw, authSecrets, requestLogger);
            }

            const beforeHandler = await executeRequestHookPhase({
              hooks: resolvedHooks.hooks,
              phase: 'beforeHandler',
              context: ctx,
              route: routeDefinition,
              logger: requestLogger
            });
            if (beforeHandler.shortCircuited && beforeHandler.result) {
              sendCommittedRouteResponse(reply, beforeHandler.result, {
                sessionState,
                session: ctx.session,
                route: routeDefinition
              });
              return;
            }

            const handlerResult = await handler(ctx);
            const afterHandler = await executeRequestHookPhase({
              hooks: resolvedHooks.hooks,
              phase: 'afterHandler',
              context: ctx,
              route: routeDefinition,
              logger: requestLogger,
              result: handlerResult
            });
            sendCommittedRouteResponse(reply, afterHandler.result ?? handlerResult, {
              sessionState,
              session: ctx.session,
              route: routeDefinition
            });
          } catch (error) {
            requestLogger.error('request handler failed', { err: error });
            if (!reply.sent) {
              reply.code(500).type('application/json').send({
                error: 'internal_error',
                message: (error as Error).message
              });
            }
          }
        }
      });
      console.info(`[fastify] mounted ${method} ${url}`);
    } catch (error) {
      console.warn('[fastify] failed to mount route', error);
    }
  }
}

function configureViewNotFoundHandler(
  app: import('fastify').FastifyInstance,
  views: readonly CompiledView[],
  authSecrets: ReturnType<typeof loadEnv>['auth'],
  sessionConfig: ReturnType<typeof loadEnv>['sessions']
): void {
  app.setNotFoundHandler(async (req, reply) => {
    const requestUrl = new URL(req.raw.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = String(req.method ?? 'GET').toUpperCase();
    const matchedView =
      method === 'GET' || method === 'HEAD'
        ? matchView(views, requestUrl.pathname)
        : undefined;

    if (!matchedView) {
      reply.code(404).type('application/json').send({
        error: 'not_found',
        path: requestUrl.pathname
      });
      return;
    }

    const requestId = extractRequestId(req);
    reply.header('x-request-id', requestId);
    const envAccessor = createEnvAccessor();
    const requestLogger = createRequestLogger(requestId).with({ route: matchedView.view.name });
    const now = () => new Date();
    const cookies = parseCookieHeader(req.headers.cookie as string | string[] | undefined);
    const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
      cookies,
      config: sessionConfig,
      now
    });

    try {
      const html = await renderRequestTimeView({
        workspaceRoot: process.cwd(),
        url: requestUrl,
        view: matchedView.view,
        params: matchedView.params,
        cookies,
        headers: toHeaderRecord(req.headers as Record<string, string | string[] | undefined>),
        auth: resolveRequestAuth(req.raw, authSecrets, requestLogger),
        session: sessionState.session,
        env: envAccessor,
        logger: requestLogger,
        requestId,
        now
      });
      const commit = sessionState.commit({
        session: sessionState.session,
        result: { status: 200 }
      });

      if (commit.setCookie) {
        appendSetCookieHeader(reply, commit.setCookie);
      }

      reply.code(200).type('text/html; charset=utf-8').send(method === 'HEAD' ? '' : html);
    } catch (error) {
      requestLogger.error('request handler failed', { err: error });
      if (!reply.sent) {
        reply.code(500).type('application/json').send({
          error: 'internal_error',
          message: (error as Error).message
        });
      }
    }
  });
}

function resolveModuleViews(definition: ModuleDefinitionLike): ModuleView[] {
  if (Array.isArray(definition.views) && definition.views.length > 0) {
    return definition.views;
  }
  if (Array.isArray(definition.manifest?.views) && definition.manifest.views.length > 0) {
    return definition.manifest.views.map((view) => ({ definition: view }));
  }
  return [];
}

async function tryLoadModuleDefinition(): Promise<ModuleDefinitionLike | undefined> {
  const candidates = ['./module.js', './module/index.js', '../module.js', '../module/index.js'];
  for (const rel of candidates) {
    try {
      const url = new URL(rel, import.meta.url);
      const mod = await import(url.toString());
      const def = (mod && (mod.module || mod.moduleDefinition || mod.default)) as ModuleDefinitionLike;
      if (def && typeof def === 'object') return def;
    } catch {
      // ignore and try next
    }
  }
  return undefined;
}

function summarizeManifest(
  manifest?: ModuleManifestLike,
  routes?: ModuleRoute[],
  views?: readonly CompiledView[]
): ManifestSummary | undefined {
  if (!manifest) return undefined;
  const routeCount = Array.isArray(manifest.routes) ? manifest.routes.length : Array.isArray(routes) ? routes.length : 0;
  const viewCount = Array.isArray(manifest.views) ? manifest.views.length : Array.isArray(views) ? views.length : 0;
  return {
    name: manifest.name,
    version: manifest.version,
    routes: routeCount,
    views: viewCount,
    capabilities: manifest.capabilities && manifest.capabilities.length > 0 ? manifest.capabilities : undefined
  };
}

function logManifestSummary(
  manifest: ModuleManifestLike | undefined,
  routes?: ModuleRoute[],
  views?: readonly CompiledView[]
): void {
  if (!manifest) {
    console.info('[fastify] manifest metadata not found.');
    return;
  }
  const caps = manifest.capabilities?.length ? ` [${manifest.capabilities.join(', ')}]` : '';
  const routeCount = Array.isArray(manifest.routes) ? manifest.routes.length : Array.isArray(routes) ? routes.length : 0;
  const viewCount = Array.isArray(manifest.views) ? manifest.views.length : Array.isArray(views) ? views.length : 0;
  console.info(`[fastify] manifest name=${manifest.name ?? 'unknown'} routes=${routeCount} views=${viewCount}${caps}`);
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

function createRequestLogger(requestId: string, bindings: Record<string, unknown> = {}): Logger {
  const logWithLevel = (level: LogLevel, message: string, metadata?: Record<string, unknown>) => {
    const bindingKeys = Object.keys(bindings);
    const suffix = bindingKeys.length ? ` ${bindingKeys.map((k) => `${k}=${JSON.stringify(bindings[k])}`).join(' ')}` : '';
    const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (metadata) {
      writer(`[${level}] [request ${requestId}] ${message}${suffix}`, metadata);
    } else {
      writer(`[${level}] [request ${requestId}] ${message}${suffix}`);
    }
  };

  return {
    level: 'info',
    log: logWithLevel,
    debug: (message, metadata) => logWithLevel('debug', message, metadata),
    info: (message, metadata) => logWithLevel('info', message, metadata),
    warn: (message, metadata) => logWithLevel('warn', message, metadata),
    error: (message, metadata) => logWithLevel('error', message, metadata),
    with(extra) {
      return createRequestLogger(requestId, { ...bindings, ...extra });
    }
  };
}

function resolveResponseStatus(result: RouteHandlerResult | undefined): number {
  if (result?.redirect) {
    return result.status ?? 303;
  }
  return result?.status ?? (result?.errors ? 400 : 200);
}

function sendCommittedRouteResponse(
  reply: import('fastify').FastifyReply,
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
  sendRouteResponse(reply, normalizedResult, commit.setCookie);
}

function sendRouteResponse(
  reply: import('fastify').FastifyReply,
  result: NormalizedRouteHandlerResult,
  setCookie?: string
): void {
  const status = resolveResponseStatus(result);
  const headers = resolveResponseHeaders(result);
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'set-cookie') {
      appendSetCookieHeader(reply, String(value));
      continue;
    }
    reply.header(key, String(value));
  }
  if (setCookie) {
    appendSetCookieHeader(reply, setCookie);
  }

  if (result.errors) {
    reply.code(status).send({ errors: result.errors });
    return;
  }

  if (result.redirect) {
    reply.code(status).send('');
    return;
  }

  const payload = result.fragment ? result.fragment.body : result.body ?? null;
  reply.code(status).send(payload);
}

function resolveResponseHeaders(result: NormalizedRouteHandlerResult | undefined): Record<string, string> {
  const headers: Record<string, string> = { ...(result?.headers ?? {}) };

  if (result?.redirect) {
    headers.location = result.redirect.location;
  }

  if (result?.fragment) {
    headers['x-webstir-fragment-target'] = result.fragment.target;
    if (result.fragment.selector) {
      headers['x-webstir-fragment-selector'] = result.fragment.selector;
    }
    if (result.fragment.mode) {
      headers['x-webstir-fragment-mode'] = result.fragment.mode;
    }
  }

  if (!('content-type' in lowerCaseHeaderMap(headers))) {
    const payload = result?.fragment ? result.fragment.body : result?.body;
    if (payload !== undefined && payload !== null) {
      headers['content-type'] = resolveContentType(payload);
    }
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

function appendSetCookieHeader(reply: import('fastify').FastifyReply, value: string): void {
  const existing = reply.getHeader('set-cookie');
  if (!existing) {
    reply.header('set-cookie', value);
    return;
  }
  const values = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  values.push(value);
  reply.header('set-cookie', values);
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

function extractRequestId(req: { id?: string; headers?: Record<string, unknown> }): string {
  if (req && typeof req.id === 'string' && req.id.length > 0) {
    return req.id;
  }
  const header = req?.headers?.['x-request-id'];
  if (typeof header === 'string' && header.length > 0) {
    return header;
  }
  if (Array.isArray(header) && header.length > 0) {
    return header[0] as string;
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
    snapshot() {
      return { status, message };
    }
  };
}

// Execute when launched directly
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
