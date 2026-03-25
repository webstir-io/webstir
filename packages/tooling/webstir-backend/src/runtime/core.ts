import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  resolveRequestHooks,
  type CompiledRequestHook,
  type RequestHookDefinitionLike,
  type RequestHookHandler,
  type RequestHookReferenceLike,
} from './request-hooks.js';
import type { SessionAwareRouteDefinitionLike } from './session.js';
import {
  compileViews,
  type CompiledView,
  type ModuleViewLike,
  type ViewDefinitionLike,
} from './views.js';

export interface EnvAccessor {
  get(name: string): string | undefined;
  require(name: string): string;
  entries(): Record<string, string | undefined>;
}

export interface RouteHandlerResult {
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

export type NormalizedRouteHandlerResult = RouteHandlerResult & {
  fragment?: {
    target: string;
    selector?: string;
    mode?: 'replace' | 'append' | 'prepend';
    body: unknown;
  };
};

export interface BackendRouteDefinitionLike extends SessionAwareRouteDefinitionLike {
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

export type RouteHandler<TContext, TResult extends RouteHandlerResult> = (
  ctx: TContext,
) => Promise<TResult> | TResult;

export interface ModuleRouteLike<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
> {
  definition?: TRouteDefinition;
  handler?: RouteHandler<TContext, TResult>;
}

export interface ModuleManifestLike<
  TRouteDefinition extends BackendRouteDefinitionLike = BackendRouteDefinitionLike,
  TViewDefinition extends ViewDefinitionLike = ViewDefinitionLike,
> {
  name?: string;
  version?: string;
  capabilities?: string[];
  requestHooks?: RequestHookDefinitionLike[];
  routes?: TRouteDefinition[];
  views?: TViewDefinition[];
}

export type LifecycleHook = (context: {
  env: EnvAccessor;
  logger: { info(message: string): void };
}) => Promise<void> | void;

export interface ModuleRequestHook<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
> {
  id?: string;
  handler?: RequestHookHandler<TContext, TResult, TRouteDefinition>;
}

export interface ModuleDefinitionLike<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike = BackendRouteDefinitionLike,
> {
  manifest?: ModuleManifestLike<TRouteDefinition>;
  routes?: ModuleRouteLike<TContext, TResult, TRouteDefinition>[];
  views?: ModuleViewLike[];
  requestHooks?: ModuleRequestHook<TContext, TResult, TRouteDefinition>[];
  init?: LifecycleHook;
  dispose?: LifecycleHook;
}

export interface CompiledRoute<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
> {
  method: string;
  name: string;
  match: (pathname: string) => { matched: boolean; params: Record<string, string> };
  handler: RouteHandler<TContext, TResult>;
  requestHooks: CompiledRequestHook<TContext, TResult, TRouteDefinition>[];
  definition?: TRouteDefinition;
}

export interface ModuleRuntime<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike = BackendRouteDefinitionLike,
> {
  definition?: ModuleDefinitionLike<TContext, TResult, TRouteDefinition>;
  manifest?: ModuleManifestLike<TRouteDefinition>;
  routes: CompiledRoute<TContext, TResult, TRouteDefinition>[];
  views: CompiledView[];
  source?: string;
  warnings?: string[];
}

export type ReadinessStatus = 'booting' | 'ready' | 'error';

export interface ReadinessState {
  status: ReadinessStatus;
  message?: string;
}

export interface ReadinessTracker {
  booting(): void;
  ready(): void;
  error(reason: string): void;
  snapshot(): ReadinessState;
}

export interface ManifestSummary {
  name?: string;
  version?: string;
  routes: number;
  views: number;
  capabilities?: string[];
}

export class RequestBodyTooLargeError extends Error {
  readonly statusCode = 413;
  readonly code = 'payload_too_large';

  constructor(maxBytes: number) {
    super(`Request body exceeded ${maxBytes} bytes.`);
  }
}

export function createProcessEnvAccessor(): EnvAccessor {
  return {
    get: (name) => process.env[name],
    require: (name) => {
      const value = process.env[name];
      if (value === undefined) {
        throw new Error(`Missing required env var ${name}`);
      }
      return value;
    },
    entries: () => ({ ...process.env }),
  };
}

export function createReadinessTracker(): ReadinessTracker {
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
    },
  };
}

export function normalizePath(value: string | undefined): string {
  if (!value || value === '/') {
    return '/';
  }
  const trimmed = value.endsWith('/') ? value.slice(0, -1) : value;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function matchRoute<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
>(
  routes: readonly CompiledRoute<TContext, TResult, TRouteDefinition>[],
  method: string,
  pathname: string,
):
  | { route: CompiledRoute<TContext, TResult, TRouteDefinition>; params: Record<string, string> }
  | undefined {
  const normalizedMethod = (method ?? 'GET').toUpperCase();
  for (const route of routes) {
    if (route.method !== normalizedMethod) {
      continue;
    }
    const { matched, params } = route.match(pathname);
    if (matched) {
      return { route, params };
    }
  }
  return undefined;
}

export async function loadModuleRuntime<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
>(options: {
  importMetaUrl: string;
  candidates?: readonly string[];
}): Promise<ModuleRuntime<TContext, TResult, TRouteDefinition>> {
  const loaded = await tryLoadModuleDefinition<TContext, TResult, TRouteDefinition>(options);
  if (!loaded) {
    return { routes: [], views: [] };
  }

  const manifest = sanitizeManifest<TRouteDefinition>(loaded.definition.manifest);
  const compiled = compileRoutes<TContext, TResult, TRouteDefinition>(
    loaded.definition.routes ?? [],
    {
      manifestRequestHooks: manifest?.requestHooks,
      requestHookImplementations: loaded.definition.requestHooks,
    },
  );
  const views = compileViews(resolveModuleViews(loaded.definition, manifest));

  return {
    definition: loaded.definition,
    manifest,
    routes: compiled.routes,
    views,
    source: loaded.source,
    warnings: compiled.warnings,
  };
}

export function summarizeManifest<TRouteDefinition extends BackendRouteDefinitionLike>(
  manifest?: ModuleManifestLike<TRouteDefinition>,
): ManifestSummary | undefined {
  if (!manifest) {
    return undefined;
  }

  return {
    name: manifest.name,
    version: manifest.version,
    routes: Array.isArray(manifest.routes) ? manifest.routes.length : 0,
    views: Array.isArray(manifest.views) ? manifest.views.length : 0,
    capabilities:
      manifest.capabilities && manifest.capabilities.length > 0 ? manifest.capabilities : undefined,
  };
}

export function logManifestSummary(
  logger: { info(message: string): void },
  manifest: ModuleManifestLike | undefined,
  routeCount: number,
  viewCount: number,
): void {
  if (!manifest) {
    logger.info(
      `[webstir-backend] manifest routes=${routeCount} views=${viewCount} (no manifest metadata found)`,
    );
    return;
  }

  const caps = manifest.capabilities?.length ? ` [${manifest.capabilities.join(', ')}]` : '';
  const routes = Array.isArray(manifest.routes) ? manifest.routes.length : routeCount;
  const views = Array.isArray(manifest.views) ? manifest.views.length : viewCount;
  logger.info(
    `[webstir-backend] manifest name=${manifest.name ?? 'unknown'} routes=${routes} views=${views}${caps}`,
  );
}

export function normalizeRouteHandlerResult(
  result: RouteHandlerResult,
): NormalizedRouteHandlerResult {
  const validatedFragment = validateFragmentResult(result.fragment);
  if (!validatedFragment.valid) {
    return {
      status: result.status && result.status >= 400 ? result.status : 500,
      headers: result.headers,
      errors: [
        {
          code: 'invalid_fragment_response',
          message: 'Fragment responses require a non-empty target, supported mode, and body.',
          details: validatedFragment.issues,
        },
      ],
    };
  }

  if (!validatedFragment.fragment) {
    return result;
  }

  return {
    ...result,
    fragment: validatedFragment.fragment,
  };
}

export function resolveResponseHeaders(
  result: NormalizedRouteHandlerResult,
): Record<string, string> {
  const headers: Record<string, string> = { ...(result.headers ?? {}) };
  const lowerCaseHeaders = lowerCaseHeaderMap(headers);

  if (result.redirect) {
    headers.location = result.redirect.location;
  }

  if (result.fragment) {
    headers['x-webstir-fragment-cache'] = 'bypass';
    headers['x-webstir-fragment-target'] = result.fragment.target;
    if (result.fragment.selector) {
      headers['x-webstir-fragment-selector'] = result.fragment.selector;
    }
    if (result.fragment.mode) {
      headers['x-webstir-fragment-mode'] = result.fragment.mode;
    }
    if (!('cache-control' in lowerCaseHeaders)) {
      headers['cache-control'] = 'no-store';
    }
  }

  if (!('content-type' in lowerCaseHeaders)) {
    const payload = result.fragment ? result.fragment.body : result.body;
    if (payload !== undefined && payload !== null) {
      headers['content-type'] = resolveContentType(payload);
    }
  }

  return headers;
}

function lowerCaseHeaderMap(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
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

function validateFragmentResult(
  fragment: RouteHandlerResult['fragment'],
):
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
      body: fragment.body,
    },
  };
}

function sanitizeManifest<TRouteDefinition extends BackendRouteDefinitionLike>(
  manifest?: ModuleManifestLike<TRouteDefinition>,
): ModuleManifestLike<TRouteDefinition> | undefined {
  if (!manifest || typeof manifest !== 'object') {
    return undefined;
  }

  return {
    ...manifest,
    routes: Array.isArray(manifest.routes) ? manifest.routes : [],
    views: Array.isArray(manifest.views) ? manifest.views : [],
    requestHooks: Array.isArray(manifest.requestHooks) ? manifest.requestHooks : [],
    capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : undefined,
  };
}

function compileRoutes<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
>(
  routes: ModuleRouteLike<TContext, TResult, TRouteDefinition>[],
  options: {
    manifestRequestHooks?: RequestHookDefinitionLike[];
    requestHookImplementations?: ModuleRequestHook<TContext, TResult, TRouteDefinition>[];
  },
): { routes: CompiledRoute<TContext, TResult, TRouteDefinition>[]; warnings: string[] } {
  const compiled: CompiledRoute<TContext, TResult, TRouteDefinition>[] = [];
  const warnings: string[] = [];

  for (const route of routes) {
    if (typeof route.handler !== 'function') {
      continue;
    }

    const method = (route.definition?.method ?? 'GET').toUpperCase();
    const pathPattern = normalizePath(route.definition?.path ?? '/');
    const routeName = route.definition?.name ?? pathPattern;
    const resolvedHooks = resolveRequestHooks<TContext, TResult, TRouteDefinition>({
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
      definition: route.definition,
    });
    warnings.push(...resolvedHooks.warnings);
  }

  return { routes: compiled, warnings };
}

function resolveModuleViews<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
>(
  definition: ModuleDefinitionLike<TContext, TResult, TRouteDefinition>,
  manifest?: ModuleManifestLike<TRouteDefinition>,
): ModuleViewLike[] {
  if (Array.isArray(definition.views) && definition.views.length > 0) {
    return definition.views;
  }
  if (Array.isArray(manifest?.views) && manifest.views.length > 0) {
    return manifest.views.map((view) => ({ definition: view }));
  }
  return [];
}

function createPathMatcher(pattern: string) {
  const normalized = normalizePath(pattern);
  const paramRegex = /:([A-Za-z0-9_]+)/g;
  const regex = new RegExp(
    '^' +
      normalized
        .replace(/\//g, '\\/')
        .replace(paramRegex, (_segment, name) => `(?<${name}>[^/]+)`) +
      '$',
  );

  return (pathname: string) => {
    const pathToTest = normalizePath(pathname);
    const match = regex.exec(pathToTest);
    if (!match) {
      return { matched: false, params: {} };
    }
    return {
      matched: true,
      params: (match.groups ?? {}) as Record<string, string>,
    };
  };
}

async function tryLoadModuleDefinition<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
>(options: {
  importMetaUrl: string;
  candidates?: readonly string[];
}): Promise<
  | { definition: ModuleDefinitionLike<TContext, TResult, TRouteDefinition>; source: string }
  | undefined
> {
  const here = path.dirname(fileURLToPath(options.importMetaUrl));
  const candidates = options.candidates ?? [
    'module.js',
    'module.mjs',
    'module/index.js',
    'module/index.mjs',
  ];

  for (const rel of candidates) {
    const full = path.join(here, rel);
    try {
      const imported = await import(`${pathToFileURL(full).href}?t=${Date.now()}`);
      const definition = extractModuleDefinition<TContext, TResult, TRouteDefinition>(imported);
      if (definition) {
        return { definition, source: rel };
      }
    } catch {
      // ignore and continue
    }
  }

  return undefined;
}

function extractModuleDefinition<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
>(
  exports: Record<string, unknown>,
): ModuleDefinitionLike<TContext, TResult, TRouteDefinition> | undefined {
  const keys = ['module', 'moduleDefinition', 'default', 'backendModule'];
  for (const key of keys) {
    if (key in exports) {
      const value = exports[key as keyof typeof exports];
      if (value && typeof value === 'object') {
        return value as ModuleDefinitionLike<TContext, TResult, TRouteDefinition>;
      }
    }
  }
  return undefined;
}
