import {
  formatClientErrorReport,
  isClientErrorsPath,
  readClientErrorReport,
} from './client-errors.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { executeRequestHookPhase, type RequestHookReferenceLike } from './request-hooks.js';
import { isProduction, setAppRoot } from '../app/app-root.js';
import { appUrl, loadAppEnv, loadEnvFiles } from '../app/env.js';
import { appServices } from '../app/services.js';
import { appDatabase, appDatabaseExists, declareWebstirTables } from '../db/app-database.js';
import type { Database } from '../db/database.js';
import { readAppMigrations } from '../db/migrations.js';
import { emailSetupProblem, type Email } from '../email/index.js';
import { LOCAL_FILES_PATH, serveLocalFile, type Files } from '../files/index.js';
import { startJobs, type Jobs } from '../jobs/index.js';
import {
  requiresSignIn,
  resolveSessionUser,
  signInLocation,
  signInRequired,
} from '../sign-in/guard.js';
import type { SessionUser } from '../sign-in/users.js';
import { createRequestMetricsTracker } from './metrics.js';
import { createDatabaseSessionStore } from './session-database-store.js';
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
  type BackendRouteDefinitionLike,
  type ReadinessTracker,
  type RouteHandlerResult,
} from './core.js';
import {
  parseCookieHeader,
  prepareSessionState,
  resolvePublishedFlash,
  type SessionCommitResult,
  type SessionCookieConfig,
  type SessionFlashMessage,
  type SessionStore,
} from './session.js';
import { ensureSessionCsrfToken } from './forms.js';
import { createSessionFormReader, renderFormRerender } from './rerender.js';
import { readRequestBody } from './request-body.js';
import { toClientNavLocation } from './client-nav.js';
import { claimSubmission, takeSubmissionId, type SubmissionClaim } from './form-submissions.js';
import { isViewRedirect, readViewControl } from './view-control.js';
import { loadNotFoundDocument } from './view-documents.js';
import {
  matchView,
  renderRequestTimeView,
  type CompiledView,
  type LoggerLike,
  type ViewFlashMessage,
} from './views.js';

export type { RouteHandlerResult } from './core.js';

export interface RuntimeLogger {
  child(bindings: Record<string, unknown>): RuntimeLogger;
  info(value: unknown, message?: string): void;
  warn(value: unknown, message?: string): void;
  error(value: unknown, message?: string): void;
}

export interface MetricsTracker {
  record(metric: { method: string; route: string; status: number; durationMs: number }): void;
  snapshot(): unknown;
}

export interface BunRuntimeEnvLike<TAuthConfig = unknown, TMetricsConfig = unknown> {
  NODE_ENV: string;
  PORT: number;
  auth: TAuthConfig;
  metrics: TMetricsConfig;
  http: {
    bodyLimitBytes: number;
  };
  sessions: SessionCookieConfig;
}

export interface BunRuntimeBootstrapOptions<
  TEnv extends BunRuntimeEnvLike = BunRuntimeEnvLike,
  TLogger extends RuntimeLogger = RuntimeLogger,
  TSession extends Record<string, unknown> = Record<string, unknown>,
  TAuth = unknown,
  TMetricsTracker extends MetricsTracker = MetricsTracker,
> {
  importMetaUrl: string;
  moduleCandidates?: readonly string[];
  loadEnv(): TEnv;
  resolveWorkspaceRoot(): string;
  resolveRequestAuth(
    request: Request,
    auth: TEnv['auth'],
    logger?: {
      warn?(message: string, metadata?: Record<string, unknown>): void;
    },
  ): Promise<TAuth | undefined>;
  createBaseLogger(env: TEnv): TLogger;
  createMetricsTracker(config: TEnv['metrics']): TMetricsTracker;
  sessionStore: SessionStore<TSession>;
}

export interface DefaultBunBackendBootstrapOptions<
  TEnv extends BunRuntimeEnvLike = BunRuntimeEnvLike,
  TLogger extends RuntimeLogger = RuntimeLogger,
  TSession extends Record<string, unknown> = Record<string, unknown>,
  TAuth = unknown,
  TMetricsTracker extends MetricsTracker = MetricsTracker,
> {
  importMetaUrl: string;
  /** The server's settings; by default, from the environment and the app's `.env` files. */
  loadEnv?(): TEnv;
  moduleCandidates?: readonly string[];
  resolveWorkspaceRoot?: () => string;
  resolveRequestAuth?: BunRuntimeBootstrapOptions<
    TEnv,
    TLogger,
    TSession,
    TAuth,
    TMetricsTracker
  >['resolveRequestAuth'];
  createBaseLogger?: (env: TEnv) => TLogger;
  createMetricsTracker?: (config: TEnv['metrics']) => TMetricsTracker;
  sessionStore?: SessionStore<TSession>;
}

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

interface RouteContext<
  TLogger extends RuntimeLogger,
  TSession extends Record<string, unknown>,
  TAuth,
> {
  request: Request;
  reply: Response;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  auth: TAuth | undefined;
  session: TSession | null;
  flash: SessionFlashMessage[];
  /** The signed-in user, when the app has sign-in; null when nobody is signed in. */
  user: SessionUser | null;
  db: Database;
  /** This request's own scratch space, for request hooks and the handler to hand values along. */
  locals: Record<string, unknown>;
  jobs: Jobs;
  email: Email;
  files: Files;
  env: EnvAccessor;
  logger: TLogger;
  requestId: string;
  now: () => Date;
}

type ModuleRouteDefinition = BackendRouteDefinitionLike & {
  requestHooks?: RequestHookReferenceLike[];
};

export async function startBunBackend<
  TEnv extends BunRuntimeEnvLike,
  TLogger extends RuntimeLogger,
  TSession extends Record<string, unknown>,
  TAuth,
  TMetricsTracker extends MetricsTracker,
>(
  options: BunRuntimeBootstrapOptions<TEnv, TLogger, TSession, TAuth, TMetricsTracker>,
): Promise<void> {
  const bun = requireBunRuntime();
  const workspaceRoot = options.resolveWorkspaceRoot();
  setAppRoot(workspaceRoot);
  loadEnvFiles(workspaceRoot);
  const env = options.loadEnv();
  const logger = options.createBaseLogger(env);
  const metrics = options.createMetricsTracker(env.metrics);
  const readiness = createReadinessTracker();
  readiness.booting();

  type BunRouteContext = RouteContext<TLogger, TSession, TAuth>;
  type BackendModuleRuntime = ModuleRuntime<
    BunRouteContext,
    RouteHandlerResult,
    ModuleRouteDefinition
  >;

  let runtime: BackendModuleRuntime;
  let loadError: string | undefined;

  try {
    runtime = await loadModuleRuntime<BunRouteContext, RouteHandlerResult, ModuleRouteDefinition>({
      importMetaUrl: options.importMetaUrl,
      candidates: options.moduleCandidates,
      workspaceRoot: options.resolveWorkspaceRoot(),
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
    logger.warn(
      '[webstir-backend] no module definition found. Add src/backend/module.ts to describe routes.',
    );
  }

  logManifestSummary(logger, runtime.manifest, runtime.routes.length, runtime.views.length);
  for (const warning of runtime.warnings ?? []) {
    logger.warn({ warning }, '[webstir-backend] module configuration warning');
  }
  const manifestSummary = summarizeManifest(runtime.manifest);
  const signInEnabled = Boolean((runtime.definition as { signIn?: unknown } | undefined)?.signIn);
  const signInProblem = checkSignInSetup(runtime, signInEnabled);
  if (signInProblem) {
    throw new Error(`[webstir-backend] ${signInProblem}`);
  }
  if (signInEnabled) declareWebstirTables('sign-in');
  // A database the app has, or needs for its migrations, opens now, so a failing migration stops
  // the server before it listens.
  if (readAppMigrations(workspaceRoot).length > 0 || appDatabaseExists()) {
    await appDatabase();
  }
  // Jobs stop with the process; one it was running goes back in the queue at the next start.
  startJobs({
    info: (message) => logger.info(message),
    warn: (message) => logger.warn(message),
    error: (message) => logger.error(message),
  });

  bun.serve({
    port: env.PORT,
    hostname: '0.0.0.0',
    fetch: async (request) => {
      return toClientNavLocation(
        request,
        await handleRequest({
          request,
          runtime,
          readiness,
          manifestSummary,
          env,
          logger,
          metrics,
          options,
          signInEnabled,
        }),
      );
    },
    error: (error) => {
      logger.error({ err: error }, '[webstir-backend] Bun server request failed');
      return jsonResponse(500, { error: 'internal_error', message: error.message });
    },
  });

  if (!loadError) {
    readiness.ready();
  }

  logger.info({ port: env.PORT, mode: env.NODE_ENV, runtime: 'bun' }, 'API server running');
}

export function createDefaultBunBackendBootstrap<
  TEnv extends BunRuntimeEnvLike,
  TLogger extends RuntimeLogger = RuntimeLogger,
  TSession extends Record<string, unknown> = Record<string, unknown>,
  TAuth = unknown,
  TMetricsTracker extends MetricsTracker = MetricsTracker,
>(
  options: DefaultBunBackendBootstrapOptions<TEnv, TLogger, TSession, TAuth, TMetricsTracker>,
): BunRuntimeBootstrapOptions<TEnv, TLogger, TSession, TAuth, TMetricsTracker> {
  return {
    importMetaUrl: options.importMetaUrl,
    moduleCandidates: options.moduleCandidates,
    loadEnv: options.loadEnv ?? (() => loadAppEnv() as TEnv),
    resolveWorkspaceRoot:
      options.resolveWorkspaceRoot ??
      (() => resolveWorkspaceRootFromImportMetaUrl(options.importMetaUrl)),
    resolveRequestAuth: options.resolveRequestAuth ?? (async () => undefined),
    createBaseLogger: options.createBaseLogger ?? (() => createDefaultBaseLogger() as TLogger),
    createMetricsTracker:
      options.createMetricsTracker ?? (() => createRequestMetricsTracker() as TMetricsTracker),
    sessionStore: options.sessionStore ?? createDatabaseSessionStore<TSession>(appDatabase),
  };
}

/**
 * What sign-in needs before the server listens: routes or views that require it need sign-in
 * enabled, and in production sign-in needs APP_URL for its links and a way to send email.
 */
function checkSignInSetup(
  runtime: {
    routes: readonly { definition?: { auth?: unknown } }[];
    views: readonly CompiledView[];
  },
  signInEnabled: boolean,
): string | undefined {
  const guarded = [
    ...runtime.routes.map((route) => route.definition),
    ...runtime.views.map((view) => view.definition as { auth?: unknown } | undefined),
  ].some(requiresSignIn);
  if (guarded && !signInEnabled) {
    return "a route or view says auth: 'required', but the app has no sign-in; run `webstir enable sign-in`.";
  }
  if (signInEnabled && isProduction()) {
    try {
      appUrl();
    } catch (error) {
      return (error as Error).message;
    }
    const email = emailSetupProblem();
    if (email) return `sign-in sends codes by email, but ${email}`;
  }
  return undefined;
}

function createDefaultBaseLogger(): RuntimeLogger {
  return {
    child() {
      return this;
    },
    info(value: unknown, message?: string) {
      writeDefaultLog('info', value, message);
    },
    warn(value: unknown, message?: string) {
      writeDefaultLog('warn', value, message);
    },
    error(value: unknown, message?: string) {
      writeDefaultLog('error', value, message);
    },
  };
}

function writeDefaultLog(level: 'info' | 'warn' | 'error', value: unknown, message?: string): void {
  const line = typeof value === 'string' && !message ? value : message;
  const detail = typeof value === 'string' && !message ? undefined : value;
  const output = [line, detail ? JSON.stringify(detail) : undefined].filter(Boolean).join(' ');

  if (level === 'error') {
    console.error(output);
    return;
  }

  if (level === 'warn') {
    console.warn(output);
    return;
  }

  console.log(output);
}

function resolveWorkspaceRootFromImportMetaUrl(importMetaUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..', '..');
}

async function handleRequest<
  TEnv extends BunRuntimeEnvLike,
  TLogger extends RuntimeLogger,
  TSession extends Record<string, unknown>,
  TAuth,
  TMetricsTracker extends MetricsTracker,
>(args: {
  request: Request;
  runtime: ModuleRuntime<
    RouteContext<TLogger, TSession, TAuth>,
    RouteHandlerResult,
    ModuleRouteDefinition
  >;
  readiness: ReadinessTracker;
  env: TEnv;
  logger: TLogger;
  metrics: TMetricsTracker;
  manifestSummary?: ManifestSummary;
  options: BunRuntimeBootstrapOptions<TEnv, TLogger, TSession, TAuth, TMetricsTracker>;
  signInEnabled: boolean;
}): Promise<Response> {
  const { request, runtime, readiness, manifestSummary, env, logger, metrics, options } = args;
  const { signInEnabled } = args;

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
        metrics: metrics.snapshot(),
      });
    }

    if (isMetricsPath(pathname)) {
      const snapshot = metrics.snapshot();
      return jsonResponse(200, snapshot ?? { enabled: false });
    }

    if (isClientErrorsPath(pathname) && method === 'POST') {
      const outcome = await readClientErrorReport(request);
      if (outcome.report) {
        logger.error(
          { clientError: outcome.report, correlationId: outcome.report.correlationId },
          `[webstir-backend] client error: ${formatClientErrorReport(outcome.report)}`,
        );
      }
      return new Response(null, { status: outcome.status });
    }

    if (method === 'OPTIONS') {
      const requestOrigin = request.headers.get('origin');
      const allowOrigin = env.NODE_ENV === 'development' ? requestOrigin : undefined;
      return new Response(null, {
        status: 204,
        headers: {
          ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
          'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers':
            request.headers.get('access-control-request-headers') ?? 'content-type',
        },
      });
    }

    if ((method === 'GET' || method === 'HEAD') && url.pathname.startsWith(LOCAL_FILES_PATH)) {
      const served = await serveLocalFile(url);
      if (served) return served;
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
      ? (matchedRoute.route.name ?? matchedRoute.route.definition?.path ?? pathname)
      : (matchedView?.view.name ?? pathname);
    const startTime = performance.now();
    const requestId = extractRequestId(request);
    const requestLogger = createBunRequestLogger(logger, request, routeName, requestId);
    const structuredLogger = createStructuredLogger(requestLogger);
    const envAccessor = createProcessEnvAccessor();
    const now = () => new Date();

    let responseStatus = 200;
    let submission: SubmissionClaim | undefined;
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
          structuredLogger,
          requestId,
          now,
          options,
          signInEnabled,
        });
        responseStatus = response.status;
        return response;
      }

      const routeMatch = matchedRoute;
      if (!routeMatch) {
        throw new Error('Expected a matched backend route.');
      }

      const body = await readRequestBody(request, env.http.bodyLimitBytes);
      const sessionState = await prepareSessionState<TSession, RouteHandlerResult>({
        cookies: parseCookieHeader(request.headers.get('cookie') ?? undefined),
        route: routeMatch.route.definition,
        config: env.sessions,
        store: options.sessionStore,
        now,
      });
      const ctx: RouteContext<TLogger, TSession, TAuth> = {
        request,
        reply: new Response(null),
        params: routeMatch.params,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
        auth: undefined,
        session: sessionState.session,
        flash: sessionState.flash,
        user: signInEnabled ? await resolveSessionUser(sessionState.session) : null,
        ...appServices,
        locals: Object.create(null),
        env: envAccessor,
        logger: requestLogger,
        requestId,
        now,
      };

      const routeDefinition = routeMatch.route.definition ?? {
        name: routeMatch.route.name,
        path: pathname,
        method,
      };

      const beforeAuth = await executeRequestHookPhase({
        hooks: routeMatch.route.requestHooks,
        phase: 'beforeAuth',
        context: ctx,
        route: routeDefinition,
        logger: structuredLogger,
      });
      if (beforeAuth.shortCircuited && beforeAuth.result) {
        const response = await createCommittedResponse(beforeAuth.result, {
          method,
          sessionState,
          session: ctx.session,
          route: routeMatch.route.definition,
          requestId,
        });
        responseStatus = response.status;
        return response;
      }

      if (ctx.auth === undefined) {
        ctx.auth = await options.resolveRequestAuth(request, env.auth, structuredLogger);
      }

      const beforeHandler = await executeRequestHookPhase({
        hooks: routeMatch.route.requestHooks,
        phase: 'beforeHandler',
        context: ctx,
        route: routeDefinition,
        logger: structuredLogger,
      });
      if (beforeHandler.shortCircuited && beforeHandler.result) {
        const response = await createCommittedResponse(beforeHandler.result, {
          method,
          sessionState,
          session: ctx.session,
          route: routeMatch.route.definition,
          requestId,
        });
        responseStatus = response.status;
        return response;
      }

      // The same form submission sent again (a lost response the browser resent, a double click)
      // goes where the first one redirected instead of running the action twice. It is answered
      // before the session guard: when the first signed in, the copy's old session has ended.
      const submissionId = method === 'POST' ? takeSubmissionId(request, ctx.body) : undefined;
      const cookieSessionId = sessionState.cookieSessionId;
      submission =
        submissionId && cookieSessionId
          ? await claimSubmission(cookieSessionId, ctx.session, submissionId, now())
          : undefined;
      const answered = submission?.answered;
      if (answered) {
        // Nothing runs, so the session is left as the first submission committed it: this
        // request's copy may predate that commit. If that commit moved the browser to another
        // session, the copy gets the same cookie, since the first response may never have landed.
        const headers = new Headers({
          location: answered.location,
          'cache-control': 'no-store',
          'x-request-id': requestId,
        });
        if (answered.setCookie) {
          headers.append('set-cookie', answered.setCookie);
        }
        responseStatus = 303;
        return new Response(null, { status: 303, headers });
      }

      if (requiresSession(routeMatch.route.definition) && ctx.session === null) {
        // The route never ran, so its flash declarations must not fire: publishing one would
        // persist a brand-new session and hand the caller the cookie needed to pass this guard.
        const response = await createCommittedResponse(createSessionRequiredResult(), {
          method,
          sessionState,
          session: null,
          route: routeMatch.route.definition,
          requestId,
          publishFlash: false,
        });
        responseStatus = response.status;
        return response;
      }

      if (requiresSignIn(routeMatch.route.definition) && ctx.user === null) {
        const response = await createCommittedResponse(
          signInRequired(request, routeMatch.route.definition),
          {
            method,
            sessionState,
            session: ctx.session,
            route: routeMatch.route.definition,
            requestId,
            publishFlash: false,
          },
        );
        responseStatus = response.status;
        return response;
      }

      let handlerResult: Awaited<ReturnType<typeof routeMatch.route.handler>>;
      try {
        handlerResult = await routeMatch.route.handler(ctx);
      } catch (error) {
        // An action can end with redirect() or notFound() just as a view loader can.
        const control = readViewControl(error);
        if (!control) {
          throw error;
        }
        const response = await createViewControlResponse(control, {
          method,
          requestId,
          workspaceRoot: options.resolveWorkspaceRoot(),
          // Its session changes land; messages already queued wait for the page it leads to.
          commit: async (status) => {
            submission?.record(
              ctx.session,
              status,
              isViewRedirect(control) ? control.location : undefined,
              now(),
            );
            const committed = await sessionState.commit({
              session: ctx.session,
              result: { status },
              retainFlash: true,
            });
            submission?.recordCookie(committed, now());
            return committed;
          },
        });
        responseStatus = response.status;
        return response;
      }
      const afterHandler = await executeRequestHookPhase({
        hooks: routeMatch.route.requestHooks,
        phase: 'afterHandler',
        context: ctx,
        route: routeDefinition,
        logger: structuredLogger,
        result: handlerResult,
      });

      const finalResult = afterHandler.result ?? handlerResult;
      if (finalResult.rerender) {
        const rerenderFlash = resolvePublishedFlash(
          routeMatch.route.definition,
          { status: finalResult.status ?? 422, flash: finalResult.flash },
          now,
        );
        let rerendered: { html: string; session: TSession | null; location: string };
        try {
          rerendered = await renderFormRerender({
            rerender: finalResult.rerender,
            views: runtime.views,
            workspaceRoot: options.resolveWorkspaceRoot(),
            url,
            routeParams: routeMatch.params,
            cookies: parseCookieHeader(request.headers.get('cookie') ?? undefined),
            headers: toRequestHeadersRecord(request.headers),
            auth: ctx.auth,
            session: ctx.session,
            env: envAccessor,
            logger: structuredLogger,
            requestId,
            now,
            services: { ...appServices, user: ctx.user },
            // The re-rendered page is where the action's messages are seen, so they are not queued.
            flash: toViewFlash([...sessionState.flash, ...rerenderFlash]),
          });
        } catch (error) {
          const control = readViewControl(error);
          if (!control) {
            throw error;
          }
          const response = await createViewControlResponse(control, {
            method,
            requestId,
            workspaceRoot: options.resolveWorkspaceRoot(),
            // No page rendered, so every message waits for the page the loader sends it to.
            commit: (status) =>
              sessionState.commit({
                session: ctx.session,
                route: routeMatch.route.definition,
                result: { status, flash: finalResult.flash },
                retainFlash: true,
              }),
          });
          responseStatus = response.status;
          return response;
        }
        const status = finalResult.status ?? 422;
        const commit = await sessionState.commit({
          session: rerendered.session,
          route: routeMatch.route.definition,
          result: { status },
          publishFlash: false,
        });
        const headers = new Headers({
          ...(finalResult.headers ?? {}),
          'cache-control': 'no-store',
          'content-type': 'text/html; charset=utf-8',
          'content-location': rerendered.location,
          'x-request-id': requestId,
        });
        if (commit.setCookie) {
          headers.append('set-cookie', commit.setCookie);
        }
        responseStatus = status;
        return new Response(method === 'HEAD' ? null : rerendered.html, { status, headers });
      }

      // A redirect that reports errors (a failed check sending the form back) does not end it.
      if (!finalResult.errors) {
        const normalized = normalizeRouteHandlerResult(finalResult);
        submission?.record(
          ctx.session,
          resolveResponseStatus(normalized),
          normalized.redirect?.location,
          now(),
        );
      }
      const response = await createCommittedResponse(finalResult, {
        method,
        sessionState,
        session: ctx.session,
        route: routeMatch.route.definition,
        requestId,
        onCommit: (commit) => submission?.recordCookie(commit, now()),
      });
      responseStatus = response.status;
      return response;
    } catch (error) {
      requestLogger.error({ err: error }, 'request handler failed');
      if (error instanceof RequestBodyTooLargeError) {
        responseStatus = error.statusCode;
        return jsonResponse(
          error.statusCode,
          { error: error.code, message: error.message },
          requestId,
        );
      }
      responseStatus = 500;
      return jsonResponse(
        500,
        {
          error: 'internal_error',
          message: (error as Error).message,
        },
        requestId,
      );
    } finally {
      submission?.release();
      const durationMs = performance.now() - startTime;
      metrics.record({
        method,
        route: routeName,
        status: responseStatus,
        durationMs,
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

async function handleViewRequest<
  TEnv extends BunRuntimeEnvLike,
  TLogger extends RuntimeLogger,
  TSession extends Record<string, unknown>,
  TAuth,
  TMetricsTracker extends MetricsTracker,
>(args: {
  request: Request;
  method: string;
  url: URL;
  matchedView: { view: CompiledView; params: Record<string, string> };
  env: TEnv;
  envAccessor: EnvAccessor;
  requestLogger: TLogger;
  structuredLogger: LoggerLike;
  requestId: string;
  now: () => Date;
  options: BunRuntimeBootstrapOptions<TEnv, TLogger, TSession, TAuth, TMetricsTracker>;
  signInEnabled: boolean;
}): Promise<Response> {
  const {
    request,
    method,
    url,
    matchedView,
    env,
    envAccessor,
    structuredLogger,
    requestId,
    now,
    options,
    signInEnabled,
  } = args;
  const rendersPage = Boolean(matchedView.view.definition?.page);
  const sessionState = await prepareSessionState<TSession, RouteHandlerResult>({
    cookies: parseCookieHeader(request.headers.get('cookie') ?? undefined),
    config: env.sessions,
    store: options.sessionStore,
    // A HEAD response has no body, so it must not use up messages meant for the page.
    consumeAllFlash: rendersPage && method !== 'HEAD',
    now,
  });
  let session = sessionState.session;
  const user = signInEnabled ? await resolveSessionUser(session) : null;
  if (requiresSignIn(matchedView.view.definition) && user === null) {
    // Messages wait for the page the visitor reaches after signing in.
    const { setCookie } = await sessionState.commit({
      session,
      result: { status: 303 },
      retainFlash: true,
    });
    const headers = new Headers({
      location: signInLocation(`${url.pathname}${url.search}`),
      'cache-control': 'no-store',
      'x-request-id': requestId,
    });
    if (setCookie) headers.append('set-cookie', setCookie);
    return new Response(null, { status: 303, headers });
  }
  let rendered: Awaited<ReturnType<typeof renderRequestTimeView>>;
  try {
    rendered = await renderRequestTimeView({
      workspaceRoot: options.resolveWorkspaceRoot(),
      url,
      view: matchedView.view,
      params: matchedView.params,
      cookies: parseCookieHeader(request.headers.get('cookie') ?? undefined),
      headers: toRequestHeadersRecord(request.headers),
      auth: await options.resolveRequestAuth(request, env.auth, structuredLogger),
      session,
      env: envAccessor,
      logger: structuredLogger,
      requestId,
      now,
      flash: rendersPage && method !== 'HEAD' ? toViewFlash(sessionState.flash) : undefined,
      forms: createSessionFormReader(() => session),
      services: { ...appServices, user },
      csrfToken: () => {
        const ensured = ensureSessionCsrfToken(session);
        session = ensured.session;
        return ensured.token;
      },
    });
  } catch (error) {
    const control = readViewControl(error);
    if (!control) {
      throw error;
    }
    return await createViewControlResponse(control, {
      method,
      requestId,
      workspaceRoot: options.resolveWorkspaceRoot(),
      // No page rendered, so its flash waits for the page the redirect leads to.
      commit: (status) => sessionState.commit({ session, result: { status }, retainFlash: true }),
    });
  }
  const commit = await sessionState.commit({
    session,
    result: { status: 200 },
  });

  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'x-request-id': requestId,
    'x-webstir-document-cache': rendered.documentCache.status,
  });
  if (commit.setCookie) {
    headers.append('set-cookie', commit.setCookie);
  }

  return new Response(method === 'HEAD' ? null : rendered.html, {
    status: 200,
    headers,
  });
}

async function createViewControlResponse(
  control: NonNullable<ReturnType<typeof readViewControl>>,
  options: {
    method: string;
    requestId: string;
    workspaceRoot: string;
    commit: (status: number) => Promise<{ setCookie?: string }>;
  },
): Promise<Response> {
  const redirecting = isViewRedirect(control);
  const status = redirecting ? control.status : 404;
  const headers = new Headers({ 'cache-control': 'no-store', 'x-request-id': options.requestId });
  const { setCookie } = await options.commit(status);
  if (setCookie) {
    headers.append('set-cookie', setCookie);
  }
  if (redirecting) {
    headers.set('location', control.location);
    return new Response(null, { status, headers });
  }
  const page = await loadNotFoundDocument(options.workspaceRoot);
  headers.set('content-type', page ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
  return new Response(options.method === 'HEAD' ? null : (page ?? 'Not found.'), {
    status,
    headers,
  });
}

function toViewFlash(flash: readonly SessionFlashMessage[]): ViewFlashMessage[] {
  return flash.map((entry) => ({ level: entry.level, message: entry.message ?? entry.key }));
}

async function createCommittedResponse<
  TSession extends Record<string, unknown>,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends BackendRouteDefinitionLike,
>(
  result: TResult,
  options: {
    method: string;
    sessionState: Awaited<ReturnType<typeof prepareSessionState<TSession, TResult>>>;
    session: TSession | null;
    route?: TRouteDefinition;
    requestId: string;
    publishFlash?: boolean;
    onCommit?: (commit: SessionCommitResult<TSession>) => void;
  },
): Promise<Response> {
  const normalizedResult = normalizeRouteHandlerResult(result);
  const commit = await options.sessionState.commit({
    session: options.session,
    route: options.route,
    result: normalizedResult as TResult,
    publishFlash: options.publishFlash,
  });
  options.onCommit?.(commit);

  const status = resolveResponseStatus(normalizedResult);
  const headers = new Headers(resolveResponseHeaders(normalizedResult));
  headers.set('x-request-id', options.requestId);
  if (commit.setCookie) {
    headers.append('set-cookie', commit.setCookie);
  }

  if (normalizedResult.redirect) {
    // Redirects may carry `errors` to classify the outcome (for example flash publishing);
    // the response itself stays a bodiless redirect.
    return new Response(null, { status, headers });
  }
  if (normalizedResult.errors) {
    return jsonResponse(status, { errors: normalizedResult.errors }, options.requestId, headers);
  }

  const payload = normalizedResult.fragment
    ? normalizedResult.fragment.body
    : normalizedResult.body;
  if (payload === undefined || payload === null || options.method === 'HEAD') {
    return new Response(null, { status, headers });
  }
  if (typeof payload === 'string' || payload instanceof ArrayBuffer) {
    return new Response(payload, { status, headers });
  }
  if (payload instanceof Uint8Array) {
    return new Response(Buffer.from(payload), { status, headers });
  }
  return jsonResponse(status, payload, options.requestId, headers);
}

function createBunRequestLogger<TLogger extends RuntimeLogger>(
  baseLogger: TLogger,
  request: Request,
  route: string,
  requestId: string,
): TLogger {
  const url = new URL(request.url);
  return baseLogger.child({
    requestId,
    method: request.method ?? 'GET',
    path: url.pathname,
    route,
  }) as TLogger;
}

function createStructuredLogger(logger: RuntimeLogger): LoggerLike {
  return {
    info(message, metadata) {
      logStructured(logger.info.bind(logger), message, metadata);
    },
    warn(message, metadata) {
      logStructured(logger.warn.bind(logger), message, metadata);
    },
    error(message, metadata) {
      logStructured(logger.error.bind(logger), message, metadata);
    },
    with(bindings) {
      return createStructuredLogger(logger.child(bindings));
    },
  };
}

function logStructured(
  log: (value: unknown, message?: string) => void,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  if (metadata && Object.keys(metadata).length > 0) {
    log(metadata, message);
    return;
  }
  log(message);
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

function toRequestHeadersRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

// `session.mode: 'required'` means a session must already exist when the route runs. It says
// nothing about identity: authenticated access is `ctx.auth`, resolved by the auth adapter or a
// request hook, and handlers or hooks still decide what an anonymous user may do.
function requiresSession(definition: BackendRouteDefinitionLike | undefined): boolean {
  const mode = definition?.session?.mode ?? definition?.form?.session?.mode;
  return mode === 'required';
}

function createSessionRequiredResult(): RouteHandlerResult {
  return {
    status: 401,
    errors: [
      {
        code: 'session_required',
        message: 'This route requires an existing session.',
      },
    ],
  };
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
  headers?: Headers,
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
    headers: responseHeaders,
  });
}

function requireBunRuntime(): BunLike {
  const bun = (globalThis as typeof globalThis & { Bun?: BunLike }).Bun;
  if (!bun?.serve) {
    throw new Error('The default Webstir backend runtime requires Bun at runtime.');
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
