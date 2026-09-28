import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

import { readWorkspacePageRoutes, type PageRoute } from '@webstir-io/webstir-backend';

export interface WorkspacePage {
  readonly name: string;
  /** The address a page has by its directory name; `home` is the root. */
  readonly routePath: string;
}

/** Every page under src/frontend/pages (a directory with an index.html), `home` first. */
export async function listWorkspacePages(workspaceRoot: string): Promise<readonly WorkspacePage[]> {
  const pagesRoot = path.join(path.resolve(workspaceRoot), 'src', 'frontend', 'pages');
  const pages = (await collectPageDirectories(pagesRoot)).map((directory) => {
    const name = path.relative(pagesRoot, directory).split(path.sep).join('/');
    return { name, routePath: name === 'home' ? '/' : `/${name}` };
  });
  return pages.sort((left, right) => comparePageNames(left.name, right.name));
}

/** The addresses a page answers: its own, and any view path patterns that render it. */
export function resolvePageRoutes(
  page: WorkspacePage,
  isRootPage: boolean,
  pageRoutes: readonly PageRoute[] = [],
): readonly string[] {
  const routes = new Set<string>();

  if (isRootPage) {
    routes.add('/');
    routes.add('/index.html');
  }

  if (page.routePath !== '/') {
    routes.add(page.routePath);
    routes.add(`${page.routePath}/`);
    routes.add(`${page.routePath}/index.html`);
  } else {
    routes.add('/home');
    routes.add('/home/');
    routes.add('/home/index.html');
  }

  for (const route of pageRoutes) {
    if (route.page !== page.name) {
      continue;
    }
    routes.add(route.pattern);
    routes.add(`${route.pattern}/`);
  }

  return Array.from(routes);
}

/**
 * Every view must name an existing page, and none may claim an address a page already owns by
 * its directory name; otherwise watch and the published server would disagree about which page
 * an address shows.
 */
export function assertPageRoutesCompatible(
  pageRoutes: readonly PageRoute[],
  pages: readonly WorkspacePage[],
): void {
  const pageNames = new Set(pages.map((page) => page.name));
  const naturalRoutes = new Map<string, string>();
  pages.forEach((page, index) => {
    for (const route of resolvePageRoutes(page, index === 0)) {
      naturalRoutes.set(route, page.name);
    }
  });

  for (const route of pageRoutes) {
    if (!pageNames.has(route.page)) {
      throw new Error(
        `[webstir] view path ${route.pattern} routes to page "${route.page}", but src/frontend/pages/${route.page} does not exist.`,
      );
    }
    const owner = naturalRoutes.get(route.pattern) ?? naturalRoutes.get(`${route.pattern}/`);
    if (owner !== undefined && owner !== route.page) {
      throw new Error(
        `[webstir] view path ${route.pattern} for page "${route.page}" is already the address of page "${owner}".`,
      );
    }
  }
}

/** Reads the workspace's view path patterns and checks them against its pages. */
export async function checkWorkspacePageRoutes(
  workspaceRoot: string,
): Promise<readonly PageRoute[]> {
  const pageRoutes = await readWorkspacePageRoutes(workspaceRoot);
  assertPageRoutesCompatible(pageRoutes, await listWorkspacePages(workspaceRoot));
  return pageRoutes;
}

async function collectPageDirectories(root: string): Promise<string[]> {
  try {
    await access(root);
  } catch {
    return [];
  }

  const directories: string[] = [];
  const stack = [path.resolve(root)];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'index.html')) {
      directories.push(current);
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  return directories;
}

function comparePageNames(left: string, right: string): number {
  if (left === 'home') return -1;
  if (right === 'home') return 1;
  return left.localeCompare(right);
}
