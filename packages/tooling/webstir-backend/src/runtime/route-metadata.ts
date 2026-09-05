import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Route metadata can be authored in two places: inline in `src/backend/module.ts` and in
 * `package.json` (`webstir.moduleManifest.routes`, written by `webstir add-route`). When both
 * describe the same method and path, the inline definition owns everything it states, and the
 * CLI-authored `session` declaration fills in what the inline definition leaves unset. A direct
 * disagreement on `session.mode` is reported and resolved to the stricter `required` value so a
 * declared requirement is never silently lost.
 */

export interface RouteSessionMetadataLike {
  mode?: string;
  write?: boolean;
}

export interface RouteMetadataLike {
  name?: string;
  method?: string;
  path?: string;
  session?: RouteSessionMetadataLike;
  form?: {
    session?: RouteSessionMetadataLike;
  };
}

export interface ReconciledRouteMetadata<TRoute extends RouteMetadataLike> {
  readonly definition: TRoute;
  readonly warnings: readonly string[];
}

export function getRouteMetadataKey(route: RouteMetadataLike | undefined): string | undefined {
  const method = typeof route?.method === 'string' ? route.method.toUpperCase() : '';
  const routePath = normalizeRouteMetadataPath(route?.path);
  if (!method || !routePath) {
    return undefined;
  }
  return `${method} ${routePath}`;
}

export function normalizeRouteMetadataPath(routePath: unknown): string | undefined {
  if (typeof routePath !== 'string' || routePath.length === 0) {
    return undefined;
  }

  let normalized = routePath;
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  normalized = normalized.replace(/\/+/g, '/');
  if (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

export function reconcileRouteSessionMetadata<TRoute extends RouteMetadataLike>(
  inline: TRoute,
  declared: RouteMetadataLike | undefined,
): ReconciledRouteMetadata<TRoute> {
  const declaredSession = declared?.session;
  if (!declaredSession || typeof declaredSession !== 'object') {
    return { definition: inline, warnings: [] };
  }

  const inlineSession = inline.session && typeof inline.session === 'object' ? inline.session : {};
  const inlineFormSession =
    inline.form?.session && typeof inline.form.session === 'object' ? inline.form.session : {};
  // The runtime reads the top-level mode first and falls back to form.session, so the
  // reconciled top-level value must never be looser than what the inline route already requires.
  const inlineMode = inlineSession.mode ?? inlineFormSession.mode;
  const warnings: string[] = [];
  let mode = inlineMode ?? declaredSession.mode;
  if (
    inlineMode !== undefined &&
    declaredSession.mode !== undefined &&
    inlineMode !== declaredSession.mode
  ) {
    mode = 'required';
    const inlineSource = inlineSession.mode !== undefined ? 'session.mode' : 'form.session.mode';
    warnings.push(
      `[webstir-backend] route ${getRouteMetadataKey(inline) ?? inline.name ?? '(unnamed)'} declares ${inlineSource} '${inlineMode}' in module.ts but session.mode '${declaredSession.mode}' in package.json (webstir.moduleManifest.routes); using 'required'. Align the two declarations to clear this warning.`,
    );
  }

  const write = inlineSession.write ?? declaredSession.write;
  const session: RouteSessionMetadataLike = {
    ...(mode !== undefined ? { mode } : {}),
    ...(write !== undefined ? { write } : {}),
  };

  return {
    definition: { ...inline, session } as TRoute,
    warnings,
  };
}

/** Reads `webstir.moduleManifest.routes` from the workspace package.json, keyed by method + path. */
export function readWorkspaceRouteMetadata(
  workspaceRoot: string | undefined,
): Map<string, RouteMetadataLike> {
  const declared = new Map<string, RouteMetadataLike>();
  if (!workspaceRoot) {
    return declared;
  }

  const pkgPath = path.join(workspaceRoot, 'package.json');
  if (!existsSync(pkgPath)) {
    return declared;
  }

  let routes: unknown;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      webstir?: { moduleManifest?: { routes?: unknown } };
    };
    routes = pkg.webstir?.moduleManifest?.routes;
  } catch {
    return declared;
  }

  if (!Array.isArray(routes)) {
    return declared;
  }

  for (const route of routes) {
    if (!route || typeof route !== 'object') {
      continue;
    }
    const key = getRouteMetadataKey(route as RouteMetadataLike);
    if (key) {
      declared.set(key, route as RouteMetadataLike);
    }
  }

  return declared;
}
