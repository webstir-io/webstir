import { startDocumentWatch } from './document-watch.ts';
import { createSsgDevPages } from './ssg-dev-pages.ts';
import type { DevServerAddress } from './dev-server.ts';
import { createStopSignal } from './stop-signal.ts';
import type { WorkspaceDescriptor } from './types.ts';
import { describeLayers } from './workspace.ts';
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
  io: WatchIo,
): Promise<void> {
  const session = await startFrontendWatchSession(workspace, options, io);

  io.stdout.write(
    `[webstir] watch starting\nworkspace: ${workspace.name}\nlayers: ${describeLayers(workspace.layers)}\nurl: ${session.address.origin}\n`,
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
  io: WatchIo,
): Promise<FrontendWatchSession> {
  return await createFrontendWatchSession(workspace, options, io);
}

async function createFrontendWatchSession(
  workspace: WorkspaceDescriptor,
  options: FrontendWatchSessionOptions,
  _io: WatchIo,
): Promise<FrontendWatchSession> {
  // Without a server, views render at publish, so watch renders them as the publish will.
  const pages = createSsgDevPages(workspace.root);
  return await startDocumentWatch({
    workspaceRoot: workspace.root,
    host: options.host,
    port: options.port,
    verbose: options.verbose,
    afterBuild: () => pages.refresh(),
    renderedPage: (pathname) => pages.lookup(pathname),
    docsModuleSwap: true,
  });
}
