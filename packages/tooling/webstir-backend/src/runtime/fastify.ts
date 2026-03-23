import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  extractRequestId as extractNodeHttpRequestId,
  loadModuleRuntime,
  normalizeRouteHandlerResult,
  resolveResponseHeaders,
  type ModuleManifestLike,
  type ModuleRuntime,
  type NodeHttpRouteDefinitionLike,
  type RouteHandlerResult,
} from './node-http.js';
import type { PreparedSessionState } from './session.js';

export {
  createProcessEnvAccessor,
  createReadinessTracker,
  summarizeManifest,
  type EnvAccessor,
  type ManifestSummary,
  type RouteHandlerResult,
} from './node-http.js';

export type FastifyRouteDefinitionLike = NodeHttpRouteDefinitionLike;

export type FastifyModuleRuntime<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends FastifyRouteDefinitionLike = FastifyRouteDefinitionLike,
> = ModuleRuntime<TContext, TResult, TRouteDefinition>;

export function logFastifyManifestSummary(
  logger: { info(message: string): void },
  manifest: ModuleManifestLike | undefined,
  routeCount: number,
  viewCount: number,
): void {
  if (!manifest) {
    logger.info('[fastify] manifest metadata not found.');
    return;
  }

  const caps = manifest.capabilities?.length ? ` [${manifest.capabilities.join(', ')}]` : '';
  const routes = Array.isArray(manifest.routes) ? manifest.routes.length : routeCount;
  const views = Array.isArray(manifest.views) ? manifest.views.length : viewCount;
  logger.info(
    `[fastify] manifest name=${manifest.name ?? 'unknown'} routes=${routes} views=${views}${caps}`,
  );
}

export async function loadFastifyModuleRuntime<
  TContext,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends FastifyRouteDefinitionLike,
>(options: {
  importMetaUrl: string;
  candidates?: readonly string[];
}): Promise<FastifyModuleRuntime<TContext, TResult, TRouteDefinition>> {
  return await loadModuleRuntime<TContext, TResult, TRouteDefinition>({
    importMetaUrl: options.importMetaUrl,
    candidates: options.candidates ?? [
      './module.js',
      './module.mjs',
      './module/index.js',
      './module/index.mjs',
      '../module.js',
      '../module.mjs',
      '../module/index.js',
      '../module/index.mjs',
    ],
  });
}

export function extractFastifyRequestId(req: Pick<FastifyRequest, 'id' | 'headers'>): string {
  if (typeof req.id === 'string' && req.id.length > 0) {
    return req.id;
  }
  return extractNodeHttpRequestId({ headers: req.headers });
}

export function sendCommittedFastifyRouteResponse<
  TSession extends Record<string, unknown>,
  TResult extends RouteHandlerResult,
  TRouteDefinition extends FastifyRouteDefinitionLike,
>(
  reply: FastifyReply,
  result: TResult,
  options: {
    sessionState: PreparedSessionState<TSession, TResult>;
    session: TSession | null;
    route?: TRouteDefinition;
  },
): void {
  const normalizedResult = normalizeRouteHandlerResult(result);
  const commit = options.sessionState.commit({
    session: options.session,
    route: options.route,
    result: normalizedResult as TResult,
  });

  sendFastifyRouteResponse(reply, normalizedResult, commit.setCookie);
}

export function isFastifyRequestBodyTooLargeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { statusCode?: unknown; code?: unknown };
  return candidate.statusCode === 413 || candidate.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
}

function sendFastifyRouteResponse(
  reply: FastifyReply,
  result: RouteHandlerResult,
  setCookie?: string,
): void {
  const status = resolveResponseStatus(result);
  const headers = resolveResponseHeaders(result);

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'set-cookie') {
      appendSetCookieHeader(reply, value);
      continue;
    }
    reply.header(key, value);
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

  const payload = result.fragment ? result.fragment.body : (result.body ?? null);
  reply.code(status).send(payload);
}

function resolveResponseStatus(result: RouteHandlerResult | undefined): number {
  if (result?.redirect) {
    return result.status ?? 303;
  }
  return result?.status ?? (result?.errors ? 400 : 200);
}

function appendSetCookieHeader(reply: FastifyReply, value: string): void {
  const existing = reply.getHeader('set-cookie');
  if (!existing) {
    reply.header('set-cookie', value);
    return;
  }

  const values = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  values.push(value);
  reply.header('set-cookie', values);
}
