import { randomUUID } from 'node:crypto';
import type http from 'node:http';

import type { Logger } from 'pino';

import { loadEnv, resolveWorkspaceRoot, type AppEnv } from '../env.js';
import { resolveRequestAuth, type AuthContext } from '../auth/adapter.js';
import { createBaseLogger } from '../observability/logger.js';
import { createMetricsTracker, type MetricsTracker } from '../observability/metrics.js';
import { sessionStore } from '../session/store.js';
import {
  executeRequestHookPhase,
  type RequestHookReferenceLike
} from '../runtime/request-hooks.js';
import {
  createProcessEnvAccessor,
  createReadinessTracker,
  loadModuleRuntime,
  logManifestSummary,
  matchRoute,
  normalizePath,
  normalizeRouteHandlerResult,
  RequestBodyTooLargeError,
  resolveResponseHeaders,
  summarizeManifest,
  type EnvAccessor,
  type ManifestSummary,
  type ModuleRuntime,
  type NodeHttpRouteDefinitionLike,
  type ReadinessTracker,
  type RouteHandler,
  type RouteHandlerResult
} from '../runtime/node-http.js';
import {
  parseCookieHeader,
  prepareSessionState,
  type SessionFlashMessage
} from '../runtime/session.js';
import {
  matchView,
  renderRequestTimeView,
  type CompiledView
} from '../runtime/views.js';

interface BunServerLike {
  stop(closeActiveConnections?: boolean): void;
}

interface BunLike {
  serve(options: {
    port: number;
    hostname?: string;
    fetch(request: Request): Response | Promise<Response>;
    error?(error: Error): Response | Promise<Response>;
  }): BunServerLike;
}

interface RouteContext {
  request: Request;
  reply: Response;
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

type ModuleRouteDefinition = NodeHttpRouteDefinitionLike & {
  requestHooks?: RequestHookReferenceLike[];
};

type BackendRouteHandler = RouteHandler<RouteContext, RouteHandlerResult>;
type BackendModuleRuntime = ModuleRuntime<RouteContext, RouteHandlerResult, ModuleRouteDefinition>;

export async function start(): Promise<void> {
  const bun = requireBunRuntime();
  const env = loadEnv();
  const logger = createBaseLogger(env);
  const metrics = createMetricsTracker(env.metrics);
  const readiness = createReadinessTracker();
  readiness.booting();

  let runtime: BackendModuleRuntime;
  let loadError: string | undefined;

  try {
    runtime = await loadModuleRuntime<RouteContext, RouteHandlerResult, ModuleRouteDefinition>({
      importMetaUrl: import.meta.url
    });
  } catch (error) {
    loadError = (error as Error).message ?? 'Failed to load module definition';
    logger.error({ err: error }, '[webstir-backend] module load failed');
    readiness.error(loadError);
    runtime = { routes: [], views: [] };
  }

  if (runtime.source) {
    logger.info(`[webstir-backend] loaded module definition from ${runtime.source}`);
  } else {
    logger.warn('[webstir-backend] no module definition found. Add src/backend/module.ts to describe routes.');
  }

  logManifestSummary(logger, runtime.manifest, runtime.routes.length, runtime.views.length);
  for (const warning of runtime.warnings ?? []) {
    logger.warn({ warning }, '[webstir-backend] request hook configuration warning');
  }
  const manifestSummary = summarizeManifest(runtime.manifest);

  bun.serve({
    port: env.PORT,
    hostname: '0.0.0.0',
    fetch: async (request) => {
      return await handleRequest({
        request,
        runtime,
        readiness,
        manifestSummary,
        env,
        logger,
        metrics
      });
    },
    error: (error) => {
      logger.error({ err: error }, '[webstir-backend] Bun server request failed');
      return jsonResponse(500, { error: 'internal_error', message: error.message });
    }
  });

  if (!loadError) {
    readiness.ready();
  }

  logger.info({ port: env.PORT, mode: env.NODE_ENV, runtime: 'bun' }, 'API server running');
}

async function handleRequest(options: {
  request: Request;
  runtime: BackendModuleRuntime;
  readiness: ReadinessTracker;
  env: AppEnv;
  logger: Logger;
  metrics: MetricsTracker;
  manifestSummary?: ManifestSummary;
}): Promise<Response> {
  const { request, runtime, readiness, manifestSummary, env, logger, metrics } = options;
  try {
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);
    const method = (request.method ?? 'GET').toUpperCase();

    if (isHealthPath(pathname)) {
      return jsonResponse(200, { ok: true, uptime: process.uptime() });
    }

    if (isReadyPath(pathname)) {
      const snapshot = readiness.snapshot();
      const statusCode = snapshot.status === 'ready' ? 200 : 503;
      return jsonResponse(statusCode, {
        status: snapshot.status,
        message: snapshot.message,
        manifest: manifestSummary,
        metrics: metrics.snapshot()
      });
    }

    if (isMetricsPath(pathname)) {
      const snapshot = metrics.snapshot();
      return jsonResponse(200, snapshot ?? { enabled: false });
    }

    if (method === 'OPTIONS') {
      const requestOrigin = request.headers.get('origin');
      const allowOrigin = env.NODE_ENV === 'development' ? requestOrigin : undefined;
      // Configure a specific production CORS allow-origin instead of reflecting arbitrary origins.
      return new Response(null, {
        status: 204,
        headers: {
          ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
          'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': request.headers.get('access-control-request-headers') ?? 'content-type'
        }
      });
    }

    const matchedRoute = matchRoute(runtime.routes, method, pathname);
    const matchedView =
      !matchedRoute && (method === 'GET' || method === 'HEAD')
        ? matchView(runtime.views, pathname)
        : undefined;

    if (!matchedRoute && !matchedView) {
      metrics.record({ method, route: pathname, status: 404, durationMs: 0 });
      return jsonResponse(404, { error: 'not_found', path: pathname });
    }

    const routeName = matchedRoute
      ? matchedRoute.route.name ?? matchedRoute.route.definition?.path ?? pathname
      : matchedView?.view.name ?? pathname;
    const startTime = performance.now();
    const requestId = extractRequestId(request);
    const requestLogger = createBunRequestLogger(logger, request, routeName, requestId);
    const envAccessor = createProcessEnvAccessor();
    const now = () => new Date();

    let responseStatus = 200;
    try {
      if (matchedView) {
        const response = await handleViewRequest({
          request,
          method,
          url,
          matchedView,
          env,
          envAccessor,
          requestLogger,
          requestId,
          now
        });
        responseStatus = response.status;
        return response;
      }

      const body = await readRequestBody(request, env.http.bodyLimitBytes);
      const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
        cookies: parseCookieHeader(request.headers.get('cookie') ?? undefined),
        route: matchedRoute.route.definition,
        config: env.sessions,
        store: sessionStore,
        now
      });
      const ctx: RouteContext = {
        request,
        reply: new Response(null),
        params: matchedRoute.params,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
        auth: undefined,
        session: sessionState.session,
        flash: sessionState.flash,
        db: Object.create(null),
        env: envAccessor,
        logger: requestLogger,
        requestId,
        now
      };

      const routeDefinition = matchedRoute.route.definition ?? {
        name: matchedRoute.route.name,
        path: pathname,
        method
      };

      const beforeAuth = await executeRequestHookPhase({
        hooks: matchedRoute.route.requestHooks,
        phase: 'beforeAuth',
        context: ctx,
        route: routeDefinition,
        logger: requestLogger
      });
      if (beforeAuth.shortCircuited && beforeAuth.result) {
        const response = createCommittedResponse(beforeAuth.result, {
          method,
          sessionState,
          session: ctx.session,
          route: matchedRoute.route.definition,
          requestId
        });
        responseStatus = response.status;
        return response;
      }

      if (ctx.auth === undefined) {
        ctx.auth = resolveRequestAuth(toNodeLikeRequest(request), env.auth, requestLogger);
      }

      const beforeHandler = await executeRequestHookPhase({
        hooks: matchedRoute.route.requestHooks,
        phase: 'beforeHandler',
        context: ctx,
        route: routeDefinition,
        logger: requestLogger
      });
      if (beforeHandler.shortCircuited && beforeHandler.result) {
        const response = createCommittedResponse(beforeHandler.result, {
          method,
          sessionState,
          session: ctx.session,
          route: matchedRoute.route.definition,
          requestId
        });
        responseStatus = response.status;
        return response;
      }

      const handlerResult = await matchedRoute.route.handler(ctx as Parameters<BackendRouteHandler>[0]);
      const afterHandler = await executeRequestHookPhase({
        hooks: matchedRoute.route.requestHooks,
        phase: 'afterHandler',
        context: ctx,
        route: routeDefinition,
        logger: requestLogger,
        result: handlerResult
      });

      const response = createCommittedResponse(afterHandler.result ?? handlerResult, {
        method,
        sessionState,
        session: ctx.session,
        route: matchedRoute.route.definition,
        requestId
      });
      responseStatus = response.status;
      return response;
    } catch (error) {
      requestLogger.error({ err: error }, 'request handler failed');
      if (error instanceof RequestBodyTooLargeError) {
        responseStatus = error.statusCode;
        return jsonResponse(error.statusCode, { error: error.code, message: error.message }, requestId);
      }
      responseStatus = 500;
      return jsonResponse(
        500,
        {
          error: 'internal_error',
          message: (error as Error).message
        },
        requestId
      );
    } finally {
      const durationMs = performance.now() - startTime;
      metrics.record({
        method,
        route: routeName,
        status: responseStatus,
        durationMs
      });
      requestLogger.info({ status: responseStatus, durationMs }, 'request.completed');
    }
  } catch (error) {
    logger.error({ err: error }, '[webstir-backend] request failed');
    if (error instanceof RequestBodyTooLargeError) {
      return jsonResponse(error.statusCode, { error: error.code, message: error.message });
    }
    return jsonResponse(500, { error: 'internal_error', message: (error as Error).message });
  }
}

async function handleViewRequest(options: {
  request: Request;
  method: string;
  url: URL;
  matchedView: { view: CompiledView; params: Record<string, string> };
  env: AppEnv;
  envAccessor: EnvAccessor;
  requestLogger: Logger;
  requestId: string;
  now: () => Date;
}): Promise<Response> {
  const { request, method, url, matchedView, env, envAccessor, requestLogger, requestId, now } = options;
  const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
    cookies: parseCookieHeader(request.headers.get('cookie') ?? undefined),
    config: env.sessions,
    store: sessionStore,
    now
  });
  const rendered = await renderRequestTimeView({
    workspaceRoot: resolveWorkspaceRoot(),
    url,
    view: matchedView.view,
    params: matchedView.params,
    cookies: parseCookieHeader(request.headers.get('cookie') ?? undefined),
    headers: toRequestHeadersRecord(request.headers),
    auth: resolveRequestAuth(toNodeLikeRequest(request), env.auth, requestLogger),
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

  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'x-request-id': requestId,
    'x-webstir-document-cache': rendered.documentCache.status
  });
  if (commit.setCookie) {
    headers.append('set-cookie', commit.setCookie);
  }

  return new Response(method === 'HEAD' ? null : rendered.html, {
    status: 200,
    headers
  });
}

function createCommittedResponse<
  TSession extends Record<string, unknown>,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends NodeHttpRouteDefinitionLike
>(
  result: TResult,
  options: {
    method: string;
    sessionState: ReturnType<typeof prepareSessionState<TSession, TResult>>;
    session: TSession | null;
    route?: TRouteDefinition;
    requestId: string;
  }
): Response {
  const normalizedResult = normalizeRouteHandlerResult(result);
  const commit = options.sessionState.commit({
    session: options.session,
    route: options.route,
    result: normalizedResult as TResult
  });

  const status = resolveResponseStatus(normalizedResult);
  const headers = new Headers(resolveResponseHeaders(normalizedResult));
  headers.set('x-request-id', options.requestId);
  if (commit.setCookie) {
    headers.append('set-cookie', commit.setCookie);
  }

  if (normalizedResult.errors) {
    return jsonResponse(status, { errors: normalizedResult.errors }, options.requestId, headers);
  }
  if (normalizedResult.redirect) {
    return new Response(null, { status, headers });
  }

  const payload = normalizedResult.fragment ? normalizedResult.fragment.body : normalizedResult.body;
  if (payload === undefined || payload === null || options.method === 'HEAD') {
    return new Response(null, { status, headers });
  }
  if (typeof payload === 'string' || payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
    return new Response(payload, { status, headers });
  }
  return jsonResponse(status, payload, options.requestId, headers);
}

async function readRequestBody(request: Request, maxBodyBytes: number): Promise<unknown> {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }

  const declaredContentLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredContentLength) && declaredContentLength > maxBodyBytes) {
    throw new RequestBodyTooLargeError(maxBodyBytes);
  }

  const bodyBuffer = await request.arrayBuffer();
  if (bodyBuffer.byteLength === 0) {
    return undefined;
  }
  if (bodyBuffer.byteLength > maxBodyBytes) {
    throw new RequestBodyTooLargeError(maxBodyBytes);
  }

  const bodyText = Buffer.from(bodyBuffer).toString('utf8');
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return undefined;
    }
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(bodyText).entries());
  }
  if (contentType.includes('text/plain')) {
    return bodyText;
  }
  return bodyText;
}

function createBunRequestLogger(baseLogger: Logger, request: Request, route: string, requestId: string): Logger {
  const url = new URL(request.url);
  return baseLogger.child({
    requestId,
    method: request.method ?? 'GET',
    path: url.pathname,
    route
  });
}

function extractRequestId(request: Request): string {
  const header = request.headers.get('x-request-id');
  if (header && header.length > 0) {
    return header;
  }
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}`;
  }
}

function toNodeLikeRequest(request: Request): http.IncomingMessage {
  return {
    headers: toIncomingHeaders(request.headers)
  } as http.IncomingMessage;
}

function toIncomingHeaders(headers: Headers): http.IncomingHttpHeaders {
  const record: http.IncomingHttpHeaders = {};
  for (const [key, value] of headers.entries()) {
    record[key] = value;
  }
  return record;
}

function toRequestHeadersRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function resolveResponseStatus(result: ReturnType<typeof normalizeRouteHandlerResult>): number {
  if (result.redirect) {
    return result.status ?? 303;
  }
  return result.status ?? (result.errors ? 400 : 200);
}

function jsonResponse(
  status: number,
  payload: unknown,
  requestId?: string,
  headers?: Headers
): Response {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has('content-type')) {
    responseHeaders.set('content-type', 'application/json');
  }
  if (requestId && !responseHeaders.has('x-request-id')) {
    responseHeaders.set('x-request-id', requestId);
  }
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders
  });
}

function requireBunRuntime(): BunLike {
  const bun = (globalThis as typeof globalThis & { Bun?: BunLike }).Bun;
  if (!bun?.serve) {
    throw new Error(
      'The Bun server scaffold requires Bun at runtime. Run the backend with Bun or leave WEBSTIR_BACKEND_SERVER_RUNTIME unset.'
    );
  }
  return bun;
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
