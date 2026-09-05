import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startBunSsgFrontendWatch } from './bun-ssg-watch.ts';
import { watch, type FSWatcher } from 'node:fs';

import { readWorkspacePageRoutes, type PageRoute } from '@webstir-io/webstir-backend';

import {
  prepareBunSpaGeneratedEntries,
  regenerateBunSpaEntry,
  resolveBunSpaGeneratedPagePaths,
  resolveBunSpaEntryPaths,
  resolveBunSpaPages,
  type BunSpaEntryPaths,
  type BunSpaPageDetails,
} from './bun-spa-document.ts';
import {
  type BunFrontendFetchHandlerOptions,
  createBunFrontendFetchHandler,
  createBunSpaRoutes,
  type BunSpaRouteEntry,
  loadBunSpaEntry,
  type ReloadableServeServer,
} from './bun-spa-routes.ts';
import type { DevServerAddress } from './dev-server.ts';
import { resolveLocalCssDependencyGraph } from './css-import-graph.ts';

export interface BunGeneratedFrontendWatchOptions {
  readonly workspaceRoot: string;
  readonly host?: string;
  readonly port?: number;
  readonly apiProxyOrigin?: string;
}

export interface BunGeneratedFrontendWatchSession {
  readonly address: DevServerAddress;
  waitForExit(): Promise<number | null>;
  stop(): Promise<void>;
}

export async function startBunGeneratedFrontendWatch(
  options: BunGeneratedFrontendWatchOptions,
): Promise<BunGeneratedFrontendWatchSession> {
  const packageJson = JSON.parse(
    await readFile(path.join(options.workspaceRoot, 'package.json'), 'utf8'),
  );
  const paths = resolveBunSpaEntryPaths(options.workspaceRoot);
  const pages = await resolveBunSpaPages(paths.workspaceRoot);
  const pageRoutes = await readWorkspacePageRoutes(paths.workspaceRoot);
  assertPageRoutesCompatible(pageRoutes, pages);
  if (packageJson.webstir?.enable?.clientNav === true) {
    // Client navigation needs independently importable page entries. Bun's HTML
    // bundler combines them; use the existing document builder/watch pipeline.
    return startBunSsgFrontendWatch(options);
  }
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8088;
  const fetchOptions = {
    apiProxyOrigin: options.apiProxyOrigin,
    notFoundRoutePath: resolveNotFoundRoutePath(pages),
  };

  await prepareBunSpaGeneratedEntries({ paths, pages });

  const servedEntries = await loadServedEntries(paths, pages, pageRoutes);
  const servedAddress = createServedAddress(
    host,
    startFrontendServer(host, port, servedEntries, fetchOptions),
  );
  const watchers = await watchRegenerationTargets(paths, pages, pageRoutes, async (nextEntries) => {
    const reloadOptions: Parameters<ReloadableServeServer['reload']>[0] = {
      fetch: createBunFrontendFetchHandler(fetchOptions),
      routes: createBunSpaRoutes(nextEntries),
    };
    servedAddress.server.reload(reloadOptions);
  });

  return createSession(servedAddress, watchers);
}

interface ServedAddress {
  readonly server: ReloadableServeServer;
  readonly address: DevServerAddress;
}

function startFrontendServer(
  host: string,
  port: number,
  spaEntries: readonly BunSpaRouteEntry[],
  fetchOptions: BunFrontendFetchHandlerOptions,
): ReloadableServeServer {
  const serverOptions = {
    hostname: host,
    port,
    routes: createBunSpaRoutes(spaEntries),
    fetch: createBunFrontendFetchHandler(fetchOptions),
  };
  return Bun.serve(
    serverOptions as unknown as Parameters<typeof Bun.serve>[0],
  ) as ReloadableServeServer;
}

function createServedAddress(host: string, server: ReloadableServeServer): ServedAddress {
  const originHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  return {
    server,
    address: {
      host: originHost,
      port: server.port,
      origin: `http://${originHost}:${server.port}`,
    },
  };
}

async function watchRegenerationTargets(
  paths: BunSpaEntryPaths,
  pages: readonly BunSpaPageDetails[],
  pageRoutes: readonly PageRoute[],
  onEntriesReload: (nextEntries: readonly BunSpaRouteEntry[]) => Promise<void>,
): Promise<Set<FSWatcher>> {
  const watchers = new Set<FSWatcher>();
  const watchersByTarget = new Map<string, FSWatcher>();
  let pagesByTarget = new Map<string, Set<string>>();
  const pendingPageNames = new Set<string>();
  let pendingRegeneration: Promise<void> | null = null;

  const refreshWatchedGraph = async () => {
    const nextPagesByTarget = await resolveRegenerationTargets(paths, pages);

    for (const [target, watcher] of watchersByTarget) {
      if (!nextPagesByTarget.has(target)) {
        watcher.close();
        watchers.delete(watcher);
        watchersByTarget.delete(target);
      }
    }

    for (const target of nextPagesByTarget.keys()) {
      if (!watchersByTarget.has(target)) {
        const watcher = watch(target, () => {
          for (const pageName of pagesByTarget.get(target) ?? []) {
            pendingPageNames.add(pageName);
          }

          if (!pendingRegeneration) {
            pendingRegeneration = drainPendingRegenerations().finally(() => {
              pendingRegeneration = null;
            });
          }
        });
        watchers.add(watcher);
        watchersByTarget.set(target, watcher);
      }
    }

    pagesByTarget = nextPagesByTarget;
  };

  const drainPendingRegenerations = async () => {
    while (pendingPageNames.size > 0) {
      const affectedPageNames = new Set(pendingPageNames);
      pendingPageNames.clear();
      const affectedPages = pages.filter((page) => affectedPageNames.has(page.name));

      await refreshWatchedGraph();
      await regenerateAndReloadSpaEntries(
        paths,
        pages,
        affectedPages,
        pageRoutes,
        onEntriesReload,
        refreshWatchedGraph,
      );
    }
  };

  await refreshWatchedGraph();
  return watchers;
}

async function resolveRegenerationTargets(
  paths: BunSpaEntryPaths,
  pages: readonly BunSpaPageDetails[],
): Promise<Map<string, Set<string>>> {
  const pagesByTarget = new Map<string, Set<string>>();
  const allPageNames = pages.map((page) => page.name);
  addTargetPages(pagesByTarget, paths.appTemplatePath, allPageNames);

  for (const dependency of await resolveLocalCssDependencyGraph(paths.appCssPath)) {
    addTargetPages(pagesByTarget, dependency, allPageNames);
  }

  for (const page of pages) {
    addTargetPages(pagesByTarget, page.htmlPath, [page.name]);
    if (page.cssPath) {
      for (const dependency of await resolveLocalCssDependencyGraph(page.cssPath)) {
        addTargetPages(pagesByTarget, dependency, [page.name]);
      }
    }
  }

  return pagesByTarget;
}

function addTargetPages(
  pagesByTarget: Map<string, Set<string>>,
  target: string,
  pageNames: readonly string[],
): void {
  const owners = pagesByTarget.get(target) ?? new Set<string>();
  for (const pageName of pageNames) {
    owners.add(pageName);
  }
  pagesByTarget.set(target, owners);
}

async function regenerateAndReloadSpaEntries(
  paths: BunSpaEntryPaths,
  pages: readonly BunSpaPageDetails[],
  affectedPages: readonly BunSpaPageDetails[],
  pageRoutes: readonly PageRoute[],
  onEntriesReload: (nextEntries: readonly BunSpaRouteEntry[]) => Promise<void>,
  onEntriesRegenerated: () => Promise<void>,
): Promise<void> {
  for (const page of affectedPages) {
    await regenerateBunSpaEntry({ paths, page });
  }

  await onEntriesRegenerated();
  await onEntriesReload(await loadServedEntries(paths, pages, pageRoutes));
}

async function loadServedEntries(
  paths: BunSpaEntryPaths,
  pages: readonly BunSpaPageDetails[],
  pageRoutes: readonly PageRoute[],
): Promise<readonly BunSpaRouteEntry[]> {
  return await Promise.all(
    pages.map(async (page, index) => {
      const generatedPaths = resolveBunSpaGeneratedPagePaths(paths, page);
      return {
        routes: resolvePageRoutes(page, index === 0, pageRoutes),
        entry: await loadBunSpaEntry(generatedPaths.generatedEntryPath),
      } satisfies BunSpaRouteEntry;
    }),
  );
}

/**
 * Bun route keys for one page: its directory path plus every view pattern that names it.
 * Bun matches exact keys before `:param` keys and never matches a trailing slash, so each
 * pattern is registered with and without one.
 */
export function resolvePageRoutes(
  page: Pick<BunSpaPageDetails, 'name' | 'routePath'>,
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
 * Every view must name an existing page, and none may claim a route a page already owns
 * by its directory name. Bun's route table is last-write-wins, so without this check a
 * view declared by a later page would silently replace a real page in watch, while the
 * published server would keep serving the file.
 */
export function assertPageRoutesCompatible(
  pageRoutes: readonly PageRoute[],
  pages: readonly Pick<BunSpaPageDetails, 'name' | 'routePath'>[],
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

function resolveNotFoundRoutePath(pages: readonly BunSpaPageDetails[]): string | undefined {
  return pages.some((page) => page.name === '404') ? '/404' : undefined;
}

function createSession(
  servedAddress: ServedAddress,
  watchers: Set<FSWatcher>,
): BunGeneratedFrontendWatchSession {
  let stopping = false;
  let exitResolver: ((code: number | null) => void) | undefined;
  const exitPromise = new Promise<number | null>((resolve) => {
    exitResolver = resolve;
  });

  return {
    address: servedAddress.address,
    waitForExit() {
      return exitPromise;
    },
    async stop() {
      if (stopping) {
        await exitPromise;
        return;
      }

      stopping = true;
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers.clear();
      servedAddress.server.stop(true);
      exitResolver?.(0);
      exitResolver = undefined;
      await exitPromise;
    },
  };
}
