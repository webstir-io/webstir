import path from 'node:path';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';

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
 * page whose build produced a render program. Watch and the published server proxy those
 * paths to the backend instead of serving the page's template as a static file.
 */
export function createRenderedViewMatcher(options: {
  readonly workspaceRoot: string;
  readonly frontendRoot: string;
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
    if (path.posix.extname(pathname) !== '') {
      return false;
    }
    const matched = matchView(await load(), pathname);
    const page = matched?.view.definition?.page;
    if (!page) {
      return false;
    }
    return await hasProgram(options.frontendRoot, page);
  };
}

async function hasProgram(frontendRoot: string, page: string): Promise<boolean> {
  const candidates = [path.join(frontendRoot, 'pages', page, 'index.program.json')];
  if (page === 'home') {
    candidates.push(path.join(frontendRoot, 'index.program.json'));
  }
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return true;
    } catch {
      // try the next location
    }
  }
  return false;
}

function viewRoutesPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'build', 'backend', VIEW_ROUTES_FILE);
}
