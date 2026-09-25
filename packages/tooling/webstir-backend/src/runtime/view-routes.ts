import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

import { isStaticAssetPath } from './deploy-static.js';
import { compileViews, matchView, type CompiledView } from './views.js';

export const VIEW_ROUTES_FILE = 'views.json';

export interface ViewRouteEntry {
  readonly name?: string;
  readonly path: string;
  readonly page?: string;
}

interface ViewDefinitionInput {
  readonly name?: unknown;
  readonly path?: unknown;
  readonly page?: unknown;
}

export async function writeViewRoutes(
  buildRoot: string,
  views: readonly ViewDefinitionInput[] | undefined,
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
 * Answers whether a request path belongs to a view the backend renders: a view that names a
 * page, with or without bindings, since its loader must run either way. Watch and the published
 * server proxy those paths to the backend instead of serving the page's template as a file.
 * Asset requests, such as a page's stylesheet, never match a view.
 */
export function createRenderedViewMatcher(options: {
  readonly workspaceRoot: string;
}): (pathname: string) => Promise<boolean> {
  let cached: { mtimeMs: number; views: CompiledView[] } | undefined;

  const load = async (): Promise<CompiledView[]> => {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(viewRoutesPath(options.workspaceRoot))).mtimeMs;
    } catch {
      cached = undefined;
      return [];
    }
    if (cached?.mtimeMs === mtimeMs) {
      return cached.views;
    }
    const entries = await readViewRoutes(options.workspaceRoot);
    const views = compileViews(
      entries
        .filter((entry) => typeof entry.page === 'string')
        .map((entry) => ({ definition: entry })),
    );
    cached = { mtimeMs, views };
    return views;
  };

  return async (pathname: string) => {
    if (isStaticAssetPath(pathname)) {
      return false;
    }
    return Boolean(matchView(await load(), pathname)?.view.definition?.page);
  };
}

function viewRoutesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'build', 'backend', VIEW_ROUTES_FILE);
}
