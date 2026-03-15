import http from 'node:http';

import type { Logger } from 'pino';

import { loadEnv, resolveWorkspaceRoot, type AppEnv } from './env.js';
import { start as startBunServer } from './server/bun.js';
import { resolveRequestAuth, type AuthContext } from './auth/adapter.js';
import { createBaseLogger, createRequestLogger } from './observability/logger.js';
import { createMetricsTracker, type MetricsTracker } from './observability/metrics.js';
import { sessionStore } from './session/store.js';
import {
  executeRequestHookPhase,
  type RequestHookReferenceLike
} from './runtime/request-hooks.js';
import {
  createProcessEnvAccessor,
  createReadinessTracker,
  extractRequestId,
  loadModuleRuntime,
  logManifestSummary,
  matchRoute,
  normalizePath,
  readRequestBody,
  RequestBodyTooLargeError,
  respondJson,
  sendCommittedRouteResponse,
  summarizeManifest,
  type EnvAccessor,
  type ManifestSummary,
  type ModuleRuntime,
  type NodeHttpRouteDefinitionLike,
  type ReadinessTracker,
  type RouteHandler,
  type RouteHandlerResult
} from './runtime/node-http.js';
import {
  parseCookieHeader,
  prepareSessionState,
  type SessionFlashMessage
} from './runtime/session.js';
import {
  matchView,
  renderRequestTimeView,
  toHeaderRecord,
} from './runtime/views.js';

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

type ModuleRouteDefinition = NodeHttpRouteDefinitionLike & {
  requestHooks?: RequestHookReferenceLike[];
};

type BackendRouteHandler = RouteHandler<RouteContext, RouteHandlerResult>;
type BackendModuleRuntime = ModuleRuntime<RouteContext, RouteHandlerResult, ModuleRouteDefinition>;

export async function start(): Promise<void> {
  const requestedServerRuntime = resolveRequestedServerRuntime(process.env.WEBSTIR_BACKEND_SERVER_RUNTIME);
  if (requestedServerRuntime === 'bun') {
    await startBunServer();
    return;
  }

  const env = loadEnv();
  const logger = createBaseLogger(env);
  if (requestedServerRuntime === 'invalid') {
    logger.warn(
      { requestedRuntime: process.env.WEBSTIR_BACKEND_SERVER_RUNTIME },
      '[webstir-backend] unsupported WEBSTIR_BACKEND_SERVER_RUNTIME; falling back to the node:http scaffold'
    );
  }
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
  runtime: BackendModuleRuntime;
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

    const matchedRoute = matchRoute(runtime.routes, method, pathname);
    const matchedView =
      !matchedRoute && (method === 'GET' || method === 'HEAD')
        ? matchView(runtime.views, pathname)
        : undefined;

    if (!matchedRoute && !matchedView) {
      respondJson(res, 404, { error: 'not_found', path: pathname });
      metrics.record({ method, route: pathname, status: 404, durationMs: 0 });
      return;
    }

    const routeName = matchedRoute
      ? matchedRoute.route.name ?? matchedRoute.route.definition?.path ?? pathname
      : matchedView?.view.name ?? pathname;
    const startTime = process.hrtime.bigint();
    const requestId = extractRequestId(req);
    res.setHeader('x-request-id', requestId);

    const requestLogger = createRequestLogger(logger, { requestId, req, route: routeName });
    const envAccessor = createProcessEnvAccessor();
    const now = () => new Date();

    let handlerFailed = false;
    try {
      if (matchedView) {
        const cookies = parseCookieHeader(req.headers.cookie);
        const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
          cookies,
          config: env.sessions,
          store: sessionStore,
          now
        });
        const rendered = await renderRequestTimeView({
          workspaceRoot: resolveWorkspaceRoot(),
          url,
          view: matchedView.view,
          params: matchedView.params,
          cookies,
          headers: toHeaderRecord(req.headers),
          auth: resolveRequestAuth(req, env.auth, requestLogger),
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

        res.statusCode = 200;
        res.setHeader('cache-control', 'no-store');
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('x-webstir-document-cache', rendered.documentCache.status);
        if (commit.setCookie) {
          appendSetCookieHeader(res, commit.setCookie);
        }
        if (method === 'HEAD') {
          res.end('');
        } else {
          res.end(rendered.html);
        }
        return;
      }

      const body = await readRequestBody(req, env.http.bodyLimitBytes);
      const db: Record<string, unknown> = Object.create(null);
      const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
        cookies: parseCookieHeader(req.headers.cookie),
        route: matchedRoute.route.definition,
        config: env.sessions,
        store: sessionStore,
        now
      });
      const ctx: RouteContext = {
        request: req,
        reply: res,
        params: matchedRoute.params,
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

      const beforeAuth = await executeRequestHookPhase({
        hooks: matchedRoute.route.requestHooks,
        phase: 'beforeAuth',
        context: ctx,
        route: matchedRoute.route.definition ?? { name: matchedRoute.route.name, path: pathname, method },
        logger: requestLogger
      });
      if (beforeAuth.shortCircuited && beforeAuth.result) {
        sendCommittedRouteResponse(res, beforeAuth.result, {
          sessionState,
          session: ctx.session,
          route: matchedRoute.route.definition
        });
        return;
      }

      if (ctx.auth === undefined) {
        ctx.auth = resolveRequestAuth(req, env.auth, requestLogger);
      }

      const beforeHandler = await executeRequestHookPhase({
        hooks: matchedRoute.route.requestHooks,
        phase: 'beforeHandler',
        context: ctx,
        route: matchedRoute.route.definition ?? { name: matchedRoute.route.name, path: pathname, method },
        logger: requestLogger
      });
      if (beforeHandler.shortCircuited && beforeHandler.result) {
        sendCommittedRouteResponse(res, beforeHandler.result, {
          sessionState,
          session: ctx.session,
          route: matchedRoute.route.definition
        });
        return;
      }

      const handlerResult = await matchedRoute.route.handler(ctx);
      const afterHandler = await executeRequestHookPhase({
        hooks: matchedRoute.route.requestHooks,
        phase: 'afterHandler',
        context: ctx,
        route: matchedRoute.route.definition ?? { name: matchedRoute.route.name, path: pathname, method },
        logger: requestLogger,
        result: handlerResult
      });
      sendCommittedRouteResponse(res, afterHandler.result ?? handlerResult, {
        sessionState,
        session: ctx.session,
        route: matchedRoute.route.definition
      });
    } catch (error) {
      handlerFailed = true;
      requestLogger.error({ err: error }, 'request handler failed');
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
      if (error instanceof RequestBodyTooLargeError) {
        respondJson(res, error.statusCode, { error: error.code, message: error.message });
        return;
      }
      respondJson(res, 500, { error: 'internal_error', message: (error as Error).message });
    } else {
      res.end();
    }
  }
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

function resolveRequestedServerRuntime(value: string | undefined): 'node' | 'bun' | 'invalid' {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'node') {
    return 'node';
  }
  if (normalized === 'bun') {
    return 'bun';
  }
  return 'invalid';
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
