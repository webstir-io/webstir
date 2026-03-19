import path from 'node:path';

import { startBunSpaFrontendWatch } from './bun-spa-watch.ts';
import { DevServer, type DevServerAddress } from './dev-server.ts';
import { resolveFrontendWatchRuntime } from './frontend-watch-runtime.ts';
import { createStopSignal } from './stop-signal.ts';
import { FrontendWatchDaemonClient } from './watch-daemon-client.ts';
import { collectWatchActions, type StructuredDiagnosticPayload } from './watch-events.ts';
import type { WorkspaceDescriptor } from './types.ts';
import type { WatchIo, WatchOptions } from './watch.ts';
import { WorkspaceWatcher, type WorkspaceWatchEvent } from './workspace-watcher.ts';

export interface FrontendWatchSession {
  readonly address: DevServerAddress;
  waitForExit(): Promise<number | null>;
  stop(): Promise<void>;
}

interface FrontendWatchSessionOptions extends WatchOptions {
  readonly server?: DevServer;
}

export async function runFrontendWatch(
  workspace: WorkspaceDescriptor,
  options: WatchOptions,
  io: WatchIo
): Promise<void> {
  const session = await startFrontendWatchSession(workspace, options, io);

  io.stdout.write(
    `[webstir] watch starting\nworkspace: ${workspace.name}\nmode: ${workspace.mode}\nurl: ${session.address.origin}\n`
  );

  const stopSignal = createStopSignal();

  try {
    const daemonExitCode = await Promise.race([
      session.waitForExit(),
      stopSignal.promise.then(() => null),
    ]);

    if (typeof daemonExitCode === 'number' && daemonExitCode !== 0) {
      throw new Error(`Frontend watch daemon exited with code ${daemonExitCode}.`);
    }
  } finally {
    stopSignal.dispose();
    await session.stop();
  }
}

export async function startFrontendWatchSession(
  workspace: WorkspaceDescriptor,
  options: FrontendWatchSessionOptions,
  io: WatchIo
): Promise<FrontendWatchSession> {
  return await createFrontendWatchSession(workspace, options, io);
}

async function createFrontendWatchSession(
  workspace: WorkspaceDescriptor,
  options: FrontendWatchSessionOptions,
  io: WatchIo
): Promise<FrontendWatchSession> {
  switch (resolveFrontendWatchRuntime(workspace, options.frontendRuntime)) {
    case 'bun':
      if (options.server) {
        throw new Error('Frontend runtime "bun" does not support an injected legacy dev server.');
      }
      return await startBunSpaFrontendWatch({
        workspaceRoot: workspace.root,
        host: options.host,
        port: options.port,
      });
    case 'legacy':
    default:
      return await createLegacyFrontendWatchSession(workspace, options, io);
  }
}

async function createLegacyFrontendWatchSession(
  workspace: WorkspaceDescriptor,
  options: FrontendWatchSessionOptions,
  io: WatchIo
): Promise<FrontendWatchSession> {
  const server = options.server ?? new DevServer({
    buildRoot: path.join(workspace.root, 'build', 'frontend'),
    host: options.host,
    port: options.port,
  });
  const ownsServer = options.server === undefined;
  const address = await server.start();

  let initialBuildReady = false;
  const daemon = new FrontendWatchDaemonClient({
    workspaceRoot: workspace.root,
    verbose: options.verbose,
    hmrVerbose: options.hmrVerbose,
    env: options.env,
    onLine(line) {
      io.stdout.write(`${line}\n`);
    },
    onErrorLine(line) {
      io.stderr.write(`${line}\n`);
    },
    onDiagnostic(payload) {
      if (!initialBuildReady && payload.code === 'frontend.watch.pipeline.success') {
        initialBuildReady = true;
        io.stdout.write(`[webstir] frontend ready at ${address.origin}\n`);
      }

      void applyDiagnostic(payload, server);
    },
  });

  const watcher = new WorkspaceWatcher({
    workspaceRoot: workspace.root,
    onEvent(event) {
      void dispatchWorkspaceEvent(event, daemon);
    },
  });

  await daemon.start();
  await watcher.start();
  await daemon.sendStart();

  let stopPromise: Promise<void> | null = null;

  return {
    address,
    async waitForExit() {
      return await daemon.waitForExit();
    },
    async stop() {
      stopPromise ??= (async () => {
        await watcher.stop();
        await daemon.stop();
        if (ownsServer) {
          await server.stop();
        }
      })();

      await stopPromise;
    },
  };
}

async function applyDiagnostic(payload: StructuredDiagnosticPayload, server: DevServer): Promise<void> {
  const actions = collectWatchActions(payload);
  for (const action of actions) {
    switch (action.type) {
      case 'status':
        await server.publishStatus(action.status);
        break;
      case 'hmr':
        await server.publishHotUpdate(action.payload);
        break;
      case 'reload':
        await server.publishReload();
        break;
      default:
        break;
    }
  }
}

async function dispatchWorkspaceEvent(
  event: WorkspaceWatchEvent,
  daemon: FrontendWatchDaemonClient
): Promise<void> {
  if (event.type === 'reload') {
    await daemon.sendReload();
    return;
  }

  await daemon.sendChange(event.path);
}
