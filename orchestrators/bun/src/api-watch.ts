import path from 'node:path';
import { startBackendWatch } from '@webstir-io/webstir-backend';

import { BackendRuntimeSupervisor } from './backend-runtime.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import { createStopSignal } from './stop-signal.ts';
import type { WorkspaceDescriptor } from './types.ts';
import type { WatchIo, WatchOptions } from './watch.ts';

export interface ApiWatchSession {
  readonly origin: string;
  stop(): Promise<void>;
}

export async function runApiWatch(
  workspace: WorkspaceDescriptor,
  options: WatchOptions,
  io: WatchIo
): Promise<void> {
  const session = await startApiWatchSession(workspace, options, io);

  io.stdout.write(
    `[webstir] watch starting\nworkspace: ${workspace.name}\nmode: ${workspace.mode}\nurl: ${session.origin}\n`
  );

  const stopSignal = createStopSignal();
  try {
    await stopSignal.promise;
  } finally {
    stopSignal.dispose();
    await session.stop();
  }
}

export async function startApiWatchSession(
  workspace: WorkspaceDescriptor,
  options: WatchOptions,
  io: WatchIo
): Promise<ApiWatchSession> {
  const runtimeEnv = {
    ...createWorkspaceRuntimeEnv(workspace.root, 'build', options.env),
    WEBSTIR_FRONTEND_DEV_SERVER: '1',
  };
  const runtime = new BackendRuntimeSupervisor({
    workspaceRoot: workspace.root,
    buildRoot: path.join(workspace.root, 'build', 'backend'),
    host: options.host ?? '127.0.0.1',
    port: options.port,
    env: runtimeEnv,
    io,
  });

  await runtime.prepare();

  let initialReadyLogged = false;
  const watchHandle = await startBackendWatch({
    workspaceRoot: workspace.root,
    env: runtimeEnv,
    onEvent: async (event) => {
      if (event.type !== 'build-complete') {
        return;
      }

      if (event.succeeded !== true) {
        io.stderr.write('[webstir] backend rebuild failed; keeping the current runtime process.\n');
        return;
      }

      await runtime.restart();
      if (!initialReadyLogged) {
        initialReadyLogged = true;
        io.stdout.write(`[webstir] backend ready at ${runtime.getOrigin()}\n`);
        return;
      }

      io.stdout.write(`[webstir] backend restarted at ${runtime.getOrigin()}\n`);
    },
  });

  return {
    origin: runtime.getOrigin(),
    async stop() {
      await runtime.stop();
      await watchHandle.stop();
    },
  };
}
