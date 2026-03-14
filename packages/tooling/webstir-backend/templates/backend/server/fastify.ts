// Optional Fastify server scaffold for richer routing
// Rename or import into your backend index to use.
import Fastify from 'fastify';

import { loadEnv, resolveWorkspaceRoot } from '../env.js';
import { resolveRequestAuth } from '../auth/adapter.js';
import {
  executeRequestHookPhase
} from '../runtime/request-hooks.js';
import {
  parseCookieHeader,
  prepareSessionState,
  type SessionFlashMessage
} from '../runtime/session.js';
import {
  createProcessEnvAccessor,
  createReadinessTracker,
  extractFastifyRequestId,
  isFastifyRequestBodyTooLargeError,
  loadFastifyModuleRuntime,
  logFastifyManifestSummary,
  sendCommittedFastifyRouteResponse,
  summarizeManifest,
  type EnvAccessor,
  type FastifyModuleRuntime,
  type FastifyRouteDefinitionLike,
  type ManifestSummary,
  type RouteHandlerResult
} from '../runtime/fastify.js';
import {
  matchView,
  renderRequestTimeView,
  toHeaderRecord,
  type CompiledView
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

type ModuleRouteDefinition = FastifyRouteDefinitionLike;

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

type BackendModuleRuntime = FastifyModuleRuntime<RouteContext, RouteHandlerResult, ModuleRouteDefinition>;

export async function start(): Promise<void> {
  const env = loadEnv();
  const port = env.PORT;
  const mode = env.NODE_ENV;
  const readiness = createReadinessTracker();
  readiness.booting();
  let loadError: string | undefined;
  let runtime: BackendModuleRuntime = { routes: [], views: [] };

  const app = Fastify({
    logger: false,
    bodyLimit: env.http.bodyLimitBytes
  });
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
  app.setErrorHandler((error, _req, reply) => {
    if (reply.sent) {
      return;
    }
    if (isFastifyRequestBodyTooLargeError(error)) {
      reply.code(413).type('application/json').send({
        error: 'payload_too_large',
        message: `Request body exceeded ${env.http.bodyLimitBytes} bytes.`
      });
      return;
    }
    reply.send(error);
  });

  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }));
  app.get('/healthz', async () => ({ ok: true }));

  let manifestSummary: ManifestSummary | undefined;

  app.get('/readyz', async (_req, reply) => {
    const snapshot = readiness.snapshot();
    const statusCode = snapshot.status === 'ready' ? 200 : 503;
    reply.code(statusCode);
    return { status: snapshot.status, message: snapshot.message, manifest: manifestSummary };
  });

  try {
    runtime = await loadFastifyModuleRuntime<RouteContext, RouteHandlerResult, ModuleRouteDefinition>({
      importMetaUrl: import.meta.url
    });
  } catch (error) {
    loadError = (error as Error).message ?? 'module load failed';
    readiness.error(loadError);
    console.error('[fastify] failed to load module definition:', error);
  }

  if (runtime.source) {
    console.info(`[fastify] loaded module definition from ${runtime.source}`);
  } else if (!loadError) {
    console.info('[fastify] no module definition found. Routes will be empty.');
  }

  logFastifyManifestSummary(console, runtime.manifest, runtime.routes.length, runtime.views.length);
  for (const warning of runtime.warnings ?? []) {
    console.warn('[fastify] request hook configuration warning', warning);
  }
  manifestSummary = summarizeManifest(runtime.manifest);
  mountRoutes(app, runtime, env.auth, env.sessions);
  configureViewNotFoundHandler(app, runtime.views, env.auth, env.sessions);

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
  runtime: BackendModuleRuntime,
  authSecrets: ReturnType<typeof loadEnv>['auth'],
  sessionConfig: ReturnType<typeof loadEnv>['sessions']
) {
  for (const route of runtime.routes) {
    try {
      const method = route.method;
      const url = String(route.definition?.path ?? '/');
      const routeName = route.name;

      app.route({
        method: method as any,
        url,
        handler: async (req, reply) => {
          const requestId = extractFastifyRequestId(req);
          reply.header('x-request-id', requestId);
          const envAccessor = createProcessEnvAccessor();
          const requestLogger = createRequestLogger(requestId).with({ route: routeName });
          const now = () => new Date();
          const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
            cookies: parseCookieHeader(req.headers.cookie as string | string[] | undefined),
            route: route.definition,
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
            const routeDefinition = route.definition ?? { name: routeName, method, path: url };
            const beforeAuth = await executeRequestHookPhase({
              hooks: route.requestHooks,
              phase: 'beforeAuth',
              context: ctx,
              route: routeDefinition,
              logger: requestLogger
            });
            if (beforeAuth.shortCircuited && beforeAuth.result) {
              sendCommittedFastifyRouteResponse(reply, beforeAuth.result, {
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
              hooks: route.requestHooks,
              phase: 'beforeHandler',
              context: ctx,
              route: routeDefinition,
              logger: requestLogger
            });
            if (beforeHandler.shortCircuited && beforeHandler.result) {
              sendCommittedFastifyRouteResponse(reply, beforeHandler.result, {
                sessionState,
                session: ctx.session,
                route: routeDefinition
              });
              return;
            }

            const handlerResult = await route.handler(ctx);
            const afterHandler = await executeRequestHookPhase({
              hooks: route.requestHooks,
              phase: 'afterHandler',
              context: ctx,
              route: routeDefinition,
              logger: requestLogger,
              result: handlerResult
            });
            sendCommittedFastifyRouteResponse(reply, afterHandler.result ?? handlerResult, {
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

    const requestId = extractFastifyRequestId(req);
    reply.header('x-request-id', requestId);
    const envAccessor = createProcessEnvAccessor();
    const requestLogger = createRequestLogger(requestId).with({ route: matchedView.view.name });
    const now = () => new Date();
    const cookies = parseCookieHeader(req.headers.cookie as string | string[] | undefined);
    const sessionState = prepareSessionState<Record<string, unknown>, RouteHandlerResult>({
      cookies,
      config: sessionConfig,
      now
    });

    try {
      const rendered = await renderRequestTimeView({
        workspaceRoot: resolveWorkspaceRoot(),
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

      reply
        .header('cache-control', 'no-store')
        .header('x-webstir-document-cache', rendered.documentCache.status)
        .code(200)
        .type('text/html; charset=utf-8')
        .send(method === 'HEAD' ? '' : rendered.html);
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
