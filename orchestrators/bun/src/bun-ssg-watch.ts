import path from 'node:path';

import { DevServer, type DevServerAddress } from './dev-server.ts';
import { ensureLocalPackageArtifacts } from './providers.ts';
import { WorkspaceWatcher } from './workspace-watcher.ts';
import type { HotUpdateAsset, HotUpdatePayload, HotUpdateTarget } from './watch-events.ts';

export interface BunSsgFrontendWatchOptions {
  readonly workspaceRoot: string;
  readonly host?: string;
  readonly port?: number;
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

  const server = new DevServer({
    buildRoot,
    host: options.host,
    port: options.port,
  });
  const address = await server.start();

  let stopping = false;
  let stopPromise: Promise<void> | null = null;
  let exitResolver: ((code: number | null) => void) | undefined;
  const exitPromise = new Promise<number | null>((resolve) => {
    exitResolver = resolve;
  });

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const runTask = async () => {
      if (stopping) {
        return;
      }

      try {
        await task();
      } catch (error) {
        await reportBuildFailure(server, error);
      }
    };

    queue = queue.then(runTask, runTask);
    return queue;
  };

  const watcher = new WorkspaceWatcher({
    workspaceRoot,
    onEvent(event) {
      void enqueue(async () => {
        await server.publishStatus('building');

        let hotUpdate: HotUpdatePayload | null = null;
        const changedPath =
          event.type === 'change' || event.type === 'reload' ? event.path : undefined;
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
      });
    },
  });

  try {
    await watcher.start();
  } catch (error) {
    stopping = true;
    await queue.catch(() => undefined);
    await server.stop();
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
        await queue.catch(() => undefined);
        await server.stop();
        exitResolver?.(0);
        exitResolver = undefined;
        await exitPromise;
      })();

      await stopPromise;
    },
  };
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
