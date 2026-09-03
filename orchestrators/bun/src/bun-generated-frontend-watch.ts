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
  const paths = resolveBunSpaEntryPaths(options.workspaceRoot);
  const pages = await resolveBunSpaPages(paths.workspaceRoot);
  const pageRoutes = await readWorkspacePageRoutes(paths.workspaceRoot);
  assertPageRoutesCompatible(pageRoutes, pages);
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
  const watchers = watchRegenerationTargets(paths, pages, pageRoutes, async (nextEntries) => {
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

function watchRegenerationTargets(
  paths: BunSpaEntryPaths,
  pages: readonly BunSpaPageDetails[],
  pageRoutes: readonly PageRoute[],
  onEntriesReload: (nextEntries: readonly BunSpaRouteEntry[]) => Promise<void>,
): Set<FSWatcher> {
  const watchers = new Set<FSWatcher>();
  let pendingRegeneration: Promise<void> | null = null;

  const regenerationTargets = new Set<string>([paths.appTemplatePath, paths.appCssPath]);
  for (const page of pages) {
    regenerationTargets.add(page.htmlPath);
    if (page.cssPath) {
      regenerationTargets.add(page.cssPath);
    }
  }

  for (const target of regenerationTargets) {
    watchers.add(
      watch(target, () => {
        if (pendingRegeneration) {
          return;
        }

        pendingRegeneration = regenerateAndReloadSpaEntries(
          paths,
          pages,
          pageRoutes,
          onEntriesReload,
        ).finally(() => {
          pendingRegeneration = null;
        });
      }),
    );
  }

  return watchers;
}

async function regenerateAndReloadSpaEntries(
  paths: BunSpaEntryPaths,
  pages: readonly BunSpaPageDetails[],
  pageRoutes: readonly PageRoute[],
  onEntriesReload: (nextEntries: readonly BunSpaRouteEntry[]) => Promise<void>,
): Promise<void> {
  for (const page of pages) {
    await regenerateBunSpaEntry({ paths, page });
  }

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
