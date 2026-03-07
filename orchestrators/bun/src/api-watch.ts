import path from 'node:path';

import { createStopSignal } from './stop-signal.ts';
import { BackendRuntimeSupervisor } from './backend-runtime.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import type { WatchIo, WatchOptions } from './watch.ts';
import type { WorkspaceDescriptor } from './types.ts';
import { ensureModuleContractArtifacts } from './providers.ts';

interface BackendWatchModule {
  startBackendWatch(options: {
    workspaceRoot: string;
    env?: Record<string, string | undefined>;
    onEvent?: (event: {
      type: 'build-start' | 'build-complete';
      succeeded?: boolean;
    }) => void | Promise<void>;
  }): Promise<{ stop(): Promise<void> }>;
}

export async function runApiWatch(
  workspace: WorkspaceDescriptor,
  options: WatchOptions,
  io: WatchIo
): Promise<void> {
  await ensureModuleContractArtifacts();
  const runtimeEnv = createWorkspaceRuntimeEnv(workspace.root, 'build', options.env);
  const { startBackendWatch } = (await importBackendWatchModule()) as BackendWatchModule;
  const runtime = new BackendRuntimeSupervisor({
    workspaceRoot: workspace.root,
    buildRoot: path.join(workspace.root, 'build', 'backend'),
    host: options.host ?? '127.0.0.1',
    port: options.port,
    env: runtimeEnv,
    io,
  });

  io.stdout.write(
    `[webstir-bun] watch starting\nworkspace: ${workspace.name}\nmode: ${workspace.mode}\nurl: ${runtime.getOrigin()}\n`
  );

  let initialReadyLogged = false;
  const watchHandle = await startBackendWatch({
    workspaceRoot: workspace.root,
    env: runtimeEnv,
    onEvent: async (event) => {
      if (event.type !== 'build-complete') {
        return;
      }

      if (event.succeeded !== true) {
        io.stderr.write('[webstir-bun] backend rebuild failed; keeping the current runtime process.\n');
        return;
      }

      await runtime.restart();
      if (!initialReadyLogged) {
        initialReadyLogged = true;
        io.stdout.write(`[webstir-bun] backend ready at ${runtime.getOrigin()}\n`);
        return;
      }

      io.stdout.write(`[webstir-bun] backend restarted at ${runtime.getOrigin()}\n`);
    },
  });

  const stopSignal = createStopSignal();
  try {
    await stopSignal.promise;
  } finally {
    stopSignal.dispose();
    await runtime.stop();
    await watchHandle.stop();
  }
}

async function importBackendWatchModule(): Promise<unknown> {
  const moduleUrl = new URL('../../../packages/tooling/webstir-backend/src/watch.ts', import.meta.url);
  return await import(moduleUrl.href);
}
