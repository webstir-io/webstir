import path from 'node:path';

import { DevServer, type DevServerAddress } from './dev-server.ts';
import { ensureLocalPackageArtifacts } from './providers.ts';
import { WorkspaceWatcher, type WorkspaceWatchEvent } from './workspace-watcher.ts';
import type { HotUpdateAsset, HotUpdatePayload, HotUpdateTarget } from './watch-events.ts';

export interface BunSsgFrontendWatchOptions {
  readonly workspaceRoot: string;
  readonly host?: string;
  readonly port?: number;
  readonly verbose?: boolean;
}

export interface BunSsgFrontendWatchSession {
  readonly address: DevServerAddress;
  waitForExit(): Promise<number | null>;
  stop(): Promise<void>;
}

interface FrontendOperationsModule {
  runBuild(options: {
    readonly workspaceRoot: string;
    readonly changedFile?: string;
  }): Promise<void>;
  runRebuild(options: {
    readonly workspaceRoot: string;
    readonly changedFile?: string;
  }): Promise<void>;
}

export async function startBunSsgFrontendWatch(
  options: BunSsgFrontendWatchOptions,
): Promise<BunSsgFrontendWatchSession> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const frontendSourceRoot = path.join(workspaceRoot, 'src', 'frontend');
  const buildRoot = path.join(workspaceRoot, 'build', 'frontend');
  const operations = await loadFrontendOperations();

  await operations.runBuild({ workspaceRoot });

  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  let exitResolver: ((code: number | null) => void) | undefined;
  const exitPromise = new Promise<number | null>((resolve) => {
    exitResolver = resolve;
  });

  let pendingEvent: WorkspaceWatchEvent | undefined;
  let drainPromise: Promise<void> | null = null;
  const drainEvents = async (): Promise<void> => {
    while (pendingEvent && !stopping) {
      const event = pendingEvent;
      pendingEvent = undefined;

      try {
        await runWatchEvent({
          event,
          server,
          operations,
          workspaceRoot,
          frontendSourceRoot,
          buildRoot,
          verbose: options.verbose === true,
        });
      } catch (error) {
        await reportBuildFailure(server, error);
      }
    }
  };
  const ensureDrain = (): Promise<void> => {
    if (!drainPromise) {
      drainPromise = drainEvents().finally(() => {
        drainPromise = null;
        if (pendingEvent && !stopping) {
          void ensureDrain();
        }
      });
    }

    return drainPromise;
  };
  const enqueueEvent = (event: WorkspaceWatchEvent): Promise<void> => {
    pendingEvent = mergeWorkspaceWatchEvents(pendingEvent, event);
    return ensureDrain();
  };

  const watcher = new WorkspaceWatcher({
    workspaceRoot,
    onEvent(event) {
      void enqueueEvent(event);
    },
  });

  try {
    await watcher.start();
  } catch (error) {
    stopping = true;
    exitResolver?.(1);
    exitResolver = undefined;
    throw error;
  }

  const server = new DevServer({
    buildRoot,
    host: options.host,
    port: options.port,
  });
  let address: DevServerAddress;
  try {
    address = await server.start();
  } catch (error) {
    stopping = true;
    await watcher.stop();
    exitResolver?.(1);
    exitResolver = undefined;
    throw error;
  }

  return {
    address,
    waitForExit() {
      return exitPromise;
    },
    async stop() {
      if (stopPromise) {
        await stopPromise;
        return;
      }

      stopPromise = (async () => {
        stopping = true;
        await watcher.stop();
        await drainPromise?.catch(() => undefined);
        await server.stop();
        exitResolver?.(0);
        exitResolver = undefined;
        await exitPromise;
      })();

      await stopPromise;
    },
  };
}

interface RunWatchEventOptions {
  readonly event: WorkspaceWatchEvent;
  readonly server: DevServer;
  readonly operations: FrontendOperationsModule;
  readonly workspaceRoot: string;
  readonly frontendSourceRoot: string;
  readonly buildRoot: string;
  readonly verbose: boolean;
}

async function runWatchEvent(options: RunWatchEventOptions): Promise<void> {
  const { event, server, operations, workspaceRoot, frontendSourceRoot, buildRoot } = options;

  if (options.verbose) {
    console.info(`[webstir] watch trigger: ${formatWorkspaceWatchEvent(event, workspaceRoot)}`);
  }

  await server.publishStatus('building');

  let hotUpdate: HotUpdatePayload | null = null;
  const changedPath = getSingleWorkspaceWatchEventPath(event);
  if (event.type === 'change') {
    await operations.runRebuild({
      workspaceRoot,
      changedFile: event.path,
    });
  } else {
    await operations.runBuild({ workspaceRoot });
  }

  if (changedPath) {
    hotUpdate = createHotUpdatePayload({
      workspaceRoot,
      frontendSourceRoot,
      buildRoot,
      changedFile: changedPath,
    });
  }

  if (hotUpdate) {
    await server.publishHotUpdate(hotUpdate);
    await server.publishStatus('success');
    return;
  }

  await server.publishStatus('hmr-fallback');
  await server.publishReload();
}

export function mergeWorkspaceWatchEvents(
  current: WorkspaceWatchEvent | undefined,
  incoming: WorkspaceWatchEvent,
): WorkspaceWatchEvent {
  if (!current) {
    return incoming;
  }

  const currentPaths = getWorkspaceWatchEventPaths(current);
  const incomingPaths = getWorkspaceWatchEventPaths(incoming);
  if (
    current.type === 'change' &&
    incoming.type === 'change' &&
    currentPaths.length === 1 &&
    incomingPaths.length === 1 &&
    currentPaths[0] === incomingPaths[0]
  ) {
    return current;
  }

  return createMergedReloadEvent([...currentPaths, ...incomingPaths]);
}

export function formatWorkspaceWatchEvent(
  event: WorkspaceWatchEvent,
  workspaceRoot: string,
): string {
  const paths = getWorkspaceWatchEventPaths(event).map((eventPath) =>
    formatWorkspaceWatchPath(workspaceRoot, eventPath),
  );

  if (event.type === 'change' && paths.length === 1) {
    return `changed ${paths[0]}`;
  }

  if (paths.length === 1) {
    return `reload ${paths[0]}`;
  }

  if (paths.length > 1) {
    const visiblePaths = paths.slice(0, 5).join(', ');
    const suffix = paths.length > 5 ? `, ... ${paths.length - 5} more` : '';
    return `reload ${paths.length} changes: ${visiblePaths}${suffix}`;
  }

  return 'reload workspace';
}

async function loadFrontendOperations(): Promise<FrontendOperationsModule> {
  await ensureLocalPackageArtifacts();
  return (await import('@webstir-io/webstir-frontend')) as FrontendOperationsModule;
}

async function reportBuildFailure(server: DevServer, error: unknown): Promise<void> {
  await server.publishStatus('error');
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[webstir] frontend rebuild failed: ${message}`);
}

function getSingleWorkspaceWatchEventPath(event: WorkspaceWatchEvent): string | undefined {
  const paths = getWorkspaceWatchEventPaths(event);
  return paths.length === 1 ? paths[0] : undefined;
}

function getWorkspaceWatchEventPaths(event: WorkspaceWatchEvent): readonly string[] {
  if (event.type === 'change') {
    return [event.path];
  }

  if (event.paths && event.paths.length > 0) {
    return event.paths;
  }

  return event.path ? [event.path] : [];
}

function createMergedReloadEvent(paths: readonly string[]): WorkspaceWatchEvent {
  const mergedPaths = Array.from(new Set(paths)).sort();
  if (mergedPaths.length === 0) {
    return { type: 'reload' };
  }

  if (mergedPaths.length === 1) {
    return { type: 'reload', path: mergedPaths[0], paths: mergedPaths };
  }

  return { type: 'reload', paths: mergedPaths };
}

function formatWorkspaceWatchPath(workspaceRoot: string, eventPath: string): string {
  const relative = path.relative(workspaceRoot, eventPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return normalizeForwardSlashes(eventPath);
  }

  return normalizeForwardSlashes(relative);
}

function createHotUpdatePayload(options: {
  readonly workspaceRoot: string;
  readonly frontendSourceRoot: string;
  readonly buildRoot: string;
  readonly changedFile: string;
}): HotUpdatePayload | null {
  const changedFile = path.resolve(options.changedFile);
  if (!isWithinDirectory(changedFile, options.frontendSourceRoot)) {
    return null;
  }

  const relativeToFrontend = path.relative(options.frontendSourceRoot, changedFile);
  const relativeParts = splitPathSegments(relativeToFrontend);
  if (relativeParts.length === 0) {
    return null;
  }

  if (relativeParts[0] === 'app' && isCssFile(changedFile)) {
    return createCssHotUpdate({
      buildRoot: options.buildRoot,
      changedFile: normalizeForwardSlashes(path.relative(options.workspaceRoot, changedFile)),
      assetRelativePath: path.posix.join('app', 'app.css'),
    });
  }

  if (relativeParts[0] === 'pages' && relativeParts.length >= 3 && isCssFile(changedFile)) {
    const pageName = relativeParts[1];
    if (!pageName) {
      return null;
    }

    return createCssHotUpdate({
      buildRoot: options.buildRoot,
      changedFile: normalizeForwardSlashes(path.relative(options.workspaceRoot, changedFile)),
      assetRelativePath: path.posix.join('pages', pageName, 'index.css'),
    });
  }

  if (
    relativeParts[0] === 'pages' &&
    relativeParts[1] === 'docs' &&
    typeof relativeParts[2] === 'string' &&
    relativeParts[2].startsWith('index.') &&
    isJavaScriptFile(changedFile)
  ) {
    console.info(
      `[webstir] docs sidebar hot update detected: ${normalizeForwardSlashes(path.relative(options.workspaceRoot, changedFile))}`,
    );
    return createJsHotUpdate({
      buildRoot: options.buildRoot,
      changedFile: normalizeForwardSlashes(path.relative(options.workspaceRoot, changedFile)),
      assetRelativePath: path.posix.join('pages', 'docs', 'index.js'),
      target: {
        kind: 'boundary',
        id: 'docs-sidebar',
      },
    });
  }

  if (
    relativeParts[0] === 'content' &&
    relativeParts[relativeParts.length - 1] === '_sidebar.json'
  ) {
    console.info(
      `[webstir] docs sidebar manifest hot update detected: ${normalizeForwardSlashes(path.relative(options.workspaceRoot, changedFile))}`,
    );
    return createJsHotUpdate({
      buildRoot: options.buildRoot,
      changedFile: normalizeForwardSlashes(path.relative(options.workspaceRoot, changedFile)),
      assetRelativePath: path.posix.join('pages', 'docs', 'index.js'),
      target: {
        kind: 'boundary',
        id: 'docs-sidebar',
      },
    });
  }

  return null;
}

function createCssHotUpdate(options: {
  readonly buildRoot: string;
  readonly changedFile: string;
  readonly assetRelativePath: string;
}): HotUpdatePayload {
  const asset = createHotUpdateAsset(options.buildRoot, options.assetRelativePath, 'css');
  return {
    requiresReload: false,
    modules: [],
    styles: [asset],
    changedFile: options.changedFile,
  };
}

function createJsHotUpdate(options: {
  readonly buildRoot: string;
  readonly changedFile: string;
  readonly assetRelativePath: string;
  readonly target?: HotUpdateTarget;
}): HotUpdatePayload {
  const asset = createHotUpdateAsset(options.buildRoot, options.assetRelativePath, 'js');
  return {
    requiresReload: false,
    modules: [asset],
    styles: [],
    target: options.target,
    changedFile: options.changedFile,
  };
}

function createHotUpdateAsset(
  buildRoot: string,
  assetRelativePath: string,
  type: HotUpdateAsset['type'],
): HotUpdateAsset {
  const normalizedRelativePath = normalizeForwardSlashes(assetRelativePath);
  return {
    type,
    path: path.join(buildRoot, normalizedRelativePath),
    relativePath: normalizedRelativePath,
    url: `/${normalizedRelativePath}`,
  };
}

function isCssFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.css';
}

function isJavaScriptFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.js' || extension === '.jsx' || extension === '.ts' || extension === '.tsx';
}

function isWithinDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function splitPathSegments(value: string): readonly string[] {
  return normalizeForwardSlashes(value).split('/').filter(Boolean);
}

function normalizeForwardSlashes(value: string): string {
  return value.split(path.sep).join('/');
}
