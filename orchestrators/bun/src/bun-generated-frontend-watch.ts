import { watch, type FSWatcher } from 'node:fs';

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
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8088;

  await prepareBunSpaGeneratedEntries({ paths, pages });

  const servedEntries = await loadServedEntries(paths, pages);
  const servedAddress = createServedAddress(
    host,
    startFrontendServer(host, port, servedEntries, options.apiProxyOrigin),
  );
  const watchers = watchRegenerationTargets(paths, pages, async (nextEntries) => {
    const reloadOptions: Parameters<ReloadableServeServer['reload']>[0] = {
      fetch: createBunFrontendFetchHandler({ apiProxyOrigin: options.apiProxyOrigin }),
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
  apiProxyOrigin?: string,
): ReloadableServeServer {
  const serverOptions = {
    hostname: host,
    port,
    routes: createBunSpaRoutes(spaEntries),
    fetch: createBunFrontendFetchHandler({ apiProxyOrigin }),
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

        pendingRegeneration = regenerateAndReloadSpaEntries(paths, pages, onEntriesReload).finally(
          () => {
            pendingRegeneration = null;
          },
        );
      }),
    );
  }

  return watchers;
}

async function regenerateAndReloadSpaEntries(
  paths: BunSpaEntryPaths,
  pages: readonly BunSpaPageDetails[],
  onEntriesReload: (nextEntries: readonly BunSpaRouteEntry[]) => Promise<void>,
): Promise<void> {
  for (const page of pages) {
    await regenerateBunSpaEntry({ paths, page });
  }

  await onEntriesReload(await loadServedEntries(paths, pages));
}

async function loadServedEntries(
  paths: BunSpaEntryPaths,
  pages: readonly BunSpaPageDetails[],
): Promise<readonly BunSpaRouteEntry[]> {
  return await Promise.all(
    pages.map(async (page, index) => {
      const generatedPaths = resolveBunSpaGeneratedPagePaths(paths, page);
      return {
        routes: resolvePageRoutes(page, index === 0),
        entry: await loadBunSpaEntry(generatedPaths.generatedEntryPath),
      } satisfies BunSpaRouteEntry;
    }),
  );
}

function resolvePageRoutes(page: BunSpaPageDetails, isRootPage: boolean): readonly string[] {
  const routes = new Set<string>();

  if (isRootPage) {
    routes.add('/');
    routes.add('/index.html');
  }

  if (page.routePath !== '/') {
    routes.add(page.routePath);
    routes.add(`${page.routePath}/`);
    routes.add(`${page.routePath}/index.html`);
    return Array.from(routes);
  }

  routes.add('/home');
  routes.add('/home/');
  routes.add('/home/index.html');
  return Array.from(routes);
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
