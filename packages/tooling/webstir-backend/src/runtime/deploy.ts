import path from 'node:path';
import {
  getFullWorkspaceProxyPath,
  proxyRequest,
  shouldProxyToBackend,
  startBackendProcess,
  waitForRuntimeReady,
} from './deploy-backend.js';
import {
  assertExists,
  DEFAULT_PUBLIC_PORT,
  defaultIo,
  getOpenPort,
  readPublishedWorkspaceMode,
  requireBunRuntime,
  textResponse,
  type DeploymentIo,
  type PublishedWorkspaceMode,
  type PublishedWorkspaceServer,
  type PublishedWorkspaceServerOptions,
} from './deploy-shared.js';
import { servePublishedStaticFile } from './deploy-static.js';

export type { DeploymentIo, PublishedWorkspaceServer, PublishedWorkspaceServerOptions };

export async function startPublishedWorkspaceServer(
  options: PublishedWorkspaceServerOptions,
): Promise<PublishedWorkspaceServer> {
  const bun = requireBunRuntime();
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const io = options.io ?? defaultIo;
  const mode = await readPublishedWorkspaceMode(workspaceRoot);
  const frontendRoot = mode === 'full' ? path.join(workspaceRoot, 'dist', 'frontend') : undefined;
  const backendEntry = path.join(workspaceRoot, 'build', 'backend', 'index.js');

  await assertExists(backendEntry, 'published backend entry');
  if (frontendRoot) {
    await assertExists(frontendRoot, 'published frontend output');
  }

  const internalPort = await getOpenPort();
  const processRecord = startBackendProcess({
    workspaceRoot,
    backendEntry,
    port: internalPort,
    env: options.env,
    io,
  });
  const backendOrigin = `http://127.0.0.1:${internalPort}`;
  let stopping = false;

  try {
    await waitForRuntimeReady(internalPort, processRecord.exitPromise);
  } catch (error) {
    processRecord.expectedExit = true;
    processRecord.child.kill('SIGTERM');
    await processRecord.exitPromise.catch(() => undefined);
    throw error;
  }

  const host = options.host ?? '0.0.0.0';
  const requestedPort = options.port ?? DEFAULT_PUBLIC_PORT;
  const server = bun.serve({
    hostname: host,
    idleTimeout: 0,
    port: requestedPort,
    fetch: async (request) =>
      await handlePublishedWorkspaceRequest({
        request,
        mode,
        frontendRoot,
        backendOrigin,
      }),
    error: (error) => textResponse(500, error.message),
  });

  processRecord.exitPromise
    .then((code) => {
      if (stopping || processRecord.expectedExit) {
        return;
      }

      io.stderr.write(
        `[webstir-backend-deploy] backend runtime exited unexpectedly with code ${code ?? 'null'}.\n`,
      );
      server.stop(true);
    })
    .catch((error) => {
      if (stopping) {
        return;
      }

      io.stderr.write(
        `[webstir-backend-deploy] backend runtime failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      server.stop(true);
    });

  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;

  return {
    origin: `http://${displayHost}:${server.port}`,
    mode,
    async stop() {
      stopping = true;
      server.stop(true);
      processRecord.expectedExit = true;
      processRecord.child.kill('SIGTERM');
      await processRecord.exitPromise.catch(() => undefined);
    },
  };
}

async function handlePublishedWorkspaceRequest(options: {
  readonly request: Request;
  readonly mode: PublishedWorkspaceMode;
  readonly frontendRoot?: string;
  readonly backendOrigin: string;
}): Promise<Response> {
  const requestUrl = new URL(options.request.url);
  const pathname = requestUrl.pathname;

  if (options.mode === 'api') {
    return await proxyRequest(options.request, requestUrl, pathname, options.backendOrigin, 'api');
  }

  if (shouldProxyToBackend(options.request, pathname)) {
    const proxyPath = getFullWorkspaceProxyPath(pathname);
    return await proxyRequest(
      options.request,
      requestUrl,
      proxyPath,
      options.backendOrigin,
      'full',
    );
  }

  if (!options.frontendRoot) {
    return textResponse(500, 'Published frontend output is not available.');
  }

  return await servePublishedStaticFile(options.request, options.frontendRoot);
}
