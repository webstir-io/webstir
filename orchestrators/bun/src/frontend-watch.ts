import path from 'node:path';

import { DevServer } from './dev-server.ts';
import { createStopSignal } from './stop-signal.ts';
import { FrontendWatchDaemonClient } from './watch-daemon-client.ts';
import { collectWatchActions, type StructuredDiagnosticPayload } from './watch-events.ts';
import type { WatchIo, WatchOptions } from './watch.ts';
import { WorkspaceWatcher, type WorkspaceWatchEvent } from './workspace-watcher.ts';
import type { WorkspaceDescriptor } from './types.ts';

export async function runFrontendWatch(
  workspace: WorkspaceDescriptor,
  options: WatchOptions,
  io: WatchIo
): Promise<void> {
  const server = new DevServer({
    buildRoot: path.join(workspace.root, 'build', 'frontend'),
    host: options.host,
    port: options.port,
  });
  const address = await server.start();
  io.stdout.write(
    `[webstir-bun] watch starting\nworkspace: ${workspace.name}\nmode: ${workspace.mode}\nurl: ${address.origin}\n`
  );

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
        io.stdout.write(`[webstir-bun] frontend ready at ${address.origin}\n`);
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

  const stopSignal = createStopSignal();

  try {
    const daemonExitCode = await Promise.race([
      daemon.waitForExit(),
      stopSignal.promise.then(() => null),
    ]);

    if (typeof daemonExitCode === 'number' && daemonExitCode !== 0) {
      throw new Error(`Frontend watch daemon exited with code ${daemonExitCode}.`);
    }
  } finally {
    stopSignal.dispose();
    await watcher.stop();
    await daemon.stop();
    await server.stop();
  }
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
