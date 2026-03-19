import path from 'node:path';

import { DevServer, type DevServerAddress } from './dev-server.ts';
import { ensureLocalPackageArtifacts } from './providers.ts';
import { WorkspaceWatcher } from './workspace-watcher.ts';

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
  runBuild(options: { readonly workspaceRoot: string; readonly changedFile?: string }): Promise<void>;
  runRebuild(options: { readonly workspaceRoot: string; readonly changedFile?: string }): Promise<void>;
}

export async function startBunSsgFrontendWatch(
  options: BunSsgFrontendWatchOptions
): Promise<BunSsgFrontendWatchSession> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const operations = await loadFrontendOperations();

  await operations.runBuild({ workspaceRoot });

  const server = new DevServer({
    buildRoot: path.join(workspaceRoot, 'build', 'frontend'),
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

        if (event.type === 'change') {
          await operations.runRebuild({
            workspaceRoot,
            changedFile: event.path,
          });
        } else {
          await operations.runBuild({ workspaceRoot });
        }

        await server.publishStatus('success');
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
  return await import('@webstir-io/webstir-frontend') as FrontendOperationsModule;
}

async function reportBuildFailure(server: DevServer, error: unknown): Promise<void> {
  await server.publishStatus('error');
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[webstir] frontend rebuild failed: ${message}`);
}
