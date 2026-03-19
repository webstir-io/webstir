import { startBunSpaFrontendWatch } from './bun-spa-watch.ts';
import { startBunSsgFrontendWatch } from './bun-ssg-watch.ts';
import type { DevServerAddress } from './dev-server.ts';
import { createStopSignal } from './stop-signal.ts';
import type { WorkspaceDescriptor } from './types.ts';
import type { WatchIo, WatchOptions } from './watch.ts';

export interface FrontendWatchSession {
  readonly address: DevServerAddress;
  waitForExit(): Promise<number | null>;
  stop(): Promise<void>;
}

type FrontendWatchSessionOptions = WatchOptions;

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
    const sessionExitCode = await Promise.race([
      session.waitForExit(),
      stopSignal.promise.then(() => null),
    ]);

    if (typeof sessionExitCode === 'number' && sessionExitCode !== 0) {
      throw new Error(`Frontend watch session exited with code ${sessionExitCode}.`);
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
  _io: WatchIo
): Promise<FrontendWatchSession> {
  if (workspace.mode === 'ssg') {
    return await startBunSsgFrontendWatch({
      workspaceRoot: workspace.root,
      host: options.host,
      port: options.port,
    });
  }

  return await startBunSpaFrontendWatch({
    workspaceRoot: workspace.root,
    host: options.host,
    port: options.port,
  });
}
