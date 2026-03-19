import { watch, type FSWatcher } from 'node:fs';

import {
  prepareBunSpaGeneratedEntry,
  regenerateBunSpaEntry,
  resolveBunSpaEntryPaths,
  resolvePrimaryBunSpaPage,
  type BunSpaEntryPaths,
  type BunSpaPageDetails,
} from './bun-spa-document.ts';
import {
  createBunFrontendFetchHandler,
  createBunSpaRoutes,
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
  options: BunGeneratedFrontendWatchOptions
): Promise<BunGeneratedFrontendWatchSession> {
  const paths = resolveBunSpaEntryPaths(options.workspaceRoot);
  const page = await resolvePrimaryBunSpaPage(paths.workspaceRoot);
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 8088;

  await prepareBunSpaGeneratedEntry({ paths, page });

  const servedEntry = await loadBunSpaEntry(paths.generatedEntryPath);
  const servedAddress = createServedAddress(
    host,
    startFrontendServer(host, port, servedEntry, options.apiProxyOrigin)
  );
  const watchers = watchRegenerationTargets(paths, page, async (nextEntry) => {
    servedAddress.server.reload({
      fetch: createBunFrontendFetchHandler({ apiProxyOrigin: options.apiProxyOrigin }),
      routes: createBunSpaRoutes(nextEntry),
    } as any);
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
  spaEntry: BodyInit,
  apiProxyOrigin?: string
): ReloadableServeServer {
  return Bun.serve({
    hostname: host,
    port,
    development: true,
    routes: createBunSpaRoutes(spaEntry),
    fetch: createBunFrontendFetchHandler({ apiProxyOrigin }),
  } as any) as ReloadableServeServer;
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
  page: BunSpaPageDetails,
  onEntryReload: (nextEntry: BodyInit) => Promise<void>
): Set<FSWatcher> {
  const watchers = new Set<FSWatcher>();
  let regenerationPromise: Promise<void> | null = null;

  const regenerationTargets = [
    paths.appTemplatePath,
    paths.appCssPath,
    page.htmlPath,
    page.cssPath,
  ];

  for (const target of regenerationTargets.filter((value): value is string => Boolean(value))) {
    watchers.add(watch(target, () => {
      regenerationPromise ??= regenerateAndReloadSpaEntry(paths, page, onEntryReload).finally(() => {
        regenerationPromise = null;
      });
    }));
  }

  return watchers;
}

async function regenerateAndReloadSpaEntry(
  paths: BunSpaEntryPaths,
  page: BunSpaPageDetails,
  onEntryReload: (nextEntry: BodyInit) => Promise<void>
): Promise<void> {
  await regenerateBunSpaEntry({ paths, page });
  await onEntryReload(await loadBunSpaEntry(paths.generatedEntryPath));
}

function createSession(
  servedAddress: ServedAddress,
  watchers: Set<FSWatcher>
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
