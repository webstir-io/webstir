import path from 'node:path';
import { createServer } from 'node:net';

import { startApiWatchSession } from './api-watch.ts';
import { DevServer } from './dev-server.ts';
import { startFrontendWatchSession } from './frontend-watch.ts';
import { createStopSignal } from './stop-signal.ts';
import type { WorkspaceDescriptor } from './types.ts';
import type { WatchIo, WatchOptions } from './watch.ts';

export async function runFullWatch(
  workspace: WorkspaceDescriptor,
  options: WatchOptions,
  io: WatchIo
): Promise<void> {
  const backendPort = await allocateBackendPort();
  const apiSession = await startApiWatchSession(workspace, { ...options, port: backendPort }, io);
  await apiSession.ready;
  const server = new DevServer({
    buildRoot: path.join(workspace.root, 'build', 'frontend'),
    host: options.host,
    port: options.port,
    apiProxyOrigin: apiSession.origin,
  });

  let frontendSession: Awaited<ReturnType<typeof startFrontendWatchSession>> | undefined;

  try {
    frontendSession = await startFrontendWatchSession(workspace, { ...options, server }, io);
    io.stdout.write(
      `[webstir] watch starting\nworkspace: ${workspace.name}\nmode: ${workspace.mode}\nurl: ${frontendSession.address.origin}\napi: ${apiSession.origin}\n`
    );

    const stopSignal = createStopSignal();
    try {
      const daemonExitCode = await Promise.race([
        frontendSession.waitForExit(),
        stopSignal.promise.then(() => null),
      ]);

      if (typeof daemonExitCode === 'number' && daemonExitCode !== 0) {
        throw new Error(`Frontend watch daemon exited with code ${daemonExitCode}.`);
      }
    } finally {
      stopSignal.dispose();
    }
  } finally {
    if (frontendSession) {
      await frontendSession.stop();
    }
    await server.stop();
    await apiSession.stop();
  }
}

async function allocateBackendPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate a backend runtime port.');
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}
