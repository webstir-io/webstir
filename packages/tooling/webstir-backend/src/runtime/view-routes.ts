import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

import { isStaticAssetPath, staticFileExists } from './deploy-static.js';
import { compileViews, matchView, type CompiledView } from './views.js';

export const VIEW_ROUTES_FILE = 'views.json';

/** A view's path, with the page it renders; or, with `method`, a GET route's path. */
export interface ViewRouteEntry {
  readonly name?: string;
  readonly path: string;
  readonly page?: string;
  readonly method?: 'GET';
}

interface ViewDefinitionInput {
  readonly name?: unknown;
  readonly path?: unknown;
  readonly page?: unknown;
}

interface RouteDefinitionInput {
  readonly name?: unknown;
  readonly method?: unknown;
  readonly path?: unknown;
}

export async function writeViewRoutes(
  buildRoot: string,
  views: readonly ViewDefinitionInput[] | undefined,
  routes: readonly RouteDefinitionInput[] | undefined = [],
): Promise<void> {
  const entries: ViewRouteEntry[] = [];
  for (const view of views ?? []) {
    if (typeof view?.path !== 'string' || view.path.length === 0) {
      continue;
    }
    entries.push({
      ...(typeof view.name === 'string' ? { name: view.name } : {}),
      path: view.path,
      ...(typeof view.page === 'string' && view.page.length > 0 ? { page: view.page } : {}),
    });
  }
  // A GET route outside /api, such as a download, is answered by the backend like a view.
  for (const route of routes ?? []) {
    if (typeof route?.path !== 'string' || route.path.length === 0) continue;
    if (typeof route.method !== 'string' || route.method.toUpperCase() !== 'GET') continue;
    entries.push({
      ...(typeof route.name === 'string' ? { name: route.name } : {}),
      path: route.path,
      method: 'GET',
    });
  }
  await mkdir(buildRoot, { recursive: true });
  await writeFile(
    path.join(buildRoot, VIEW_ROUTES_FILE),
    `${JSON.stringify(entries, null, 2)}\n`,
    'utf8',
  );
}

export async function readViewRoutes(workspaceRoot: string): Promise<readonly ViewRouteEntry[]> {
  try {
    const raw = await readFile(viewRoutesPath(workspaceRoot), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ViewRouteEntry[]) : [];
  } catch {
    return [];
  }
}

export async function hasRenderedViewRoutes(workspaceRoot: string): Promise<boolean> {
  return (await readViewRoutes(workspaceRoot)).some((entry) => typeof entry.page === 'string');
}

/**
 * Answers whether a request path is the backend's to answer: a view that names a page, with or
 * without bindings, since its loader must run either way, or a GET route the app declares. Watch
 * and the published server proxy those paths to the backend instead of serving a file. Only an
 * asset that exists as a file, such as a page's stylesheet, is served in a view's place; a GET
 * route yields to any file or page at its address.
 */
export function createRenderedViewMatcher(options: {
  readonly workspaceRoot: string;
  readonly frontendRoot: string;
}): (pathname: string) => Promise<boolean> {
  type Compiled = { views: CompiledView[]; routes: CompiledView[] };
  let cached: (Compiled & { mtimeMs: number }) | undefined;

  const load = async (): Promise<Compiled> => {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(viewRoutesPath(options.workspaceRoot))).mtimeMs;
    } catch {
      cached = undefined;
      return { views: [], routes: [] };
    }
    if (cached?.mtimeMs === mtimeMs) {
      return cached;
    }
    const entries = await readViewRoutes(options.workspaceRoot);
    const compile = (keep: (entry: ViewRouteEntry) => boolean) =>
      compileViews(entries.filter(keep).map((entry) => ({ definition: entry })));
    cached = {
      mtimeMs,
      views: compile((entry) => typeof entry.page === 'string'),
      routes: compile((entry) => entry.method === 'GET'),
    };
    return cached;
  };

  return async (pathname: string) => {
    const { views, routes } = await load();
    if (!matchView(views, pathname)?.view.definition?.page) {
      // A GET route yields to any file or page the site has at that address, such as
      // /favicon.ico or /about/ beside a `/:code` route.
      return (
        matchView(routes, pathname) !== undefined &&
        !(await staticFileExists(options.frontendRoot, pathname))
      );
    }
    return !(
      isStaticAssetPath(pathname) && (await staticFileExists(options.frontendRoot, pathname))
    );
  };
}

function viewRoutesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'build', 'backend', VIEW_ROUTES_FILE);
}
