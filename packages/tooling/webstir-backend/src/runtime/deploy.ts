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
  readPublishedLayers,
  requireBunRuntime,
  textResponse,
  type DeploymentIo,
  type PublishedWorkspaceServer,
  type PublishedWorkspaceServerOptions,
} from './deploy-shared.js';
import { servePublishedStaticFile } from './deploy-static.js';
import { readWorkspacePageRoutes, type PageRoute } from './page-routes.js';
import { readEnvFiles } from '../app/env.js';
import { drainServer, shutdownTimeoutMs } from './shutdown.js';
import { createRenderedViewMatcher, readRenderedPages } from './view-routes.js';

function definedOnly(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

export type { DeploymentIo, PublishedWorkspaceServer, PublishedWorkspaceServerOptions };

export async function startPublishedWorkspaceServer(
  options: PublishedWorkspaceServerOptions,
): Promise<PublishedWorkspaceServer> {
  const bun = requireBunRuntime();
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const io = options.io ?? defaultIo;
  const layers = readPublishedLayers(workspaceRoot);
  const frontendRoot = layers.pages ? path.join(workspaceRoot, 'dist', 'frontend') : undefined;
  const backendEntry = path.join(workspaceRoot, 'build', 'backend', 'index.js');

  await assertExists(backendEntry, 'published backend entry');
  if (frontendRoot) {
    await assertExists(frontendRoot, 'published frontend output');
  }
  const pageRoutes = frontendRoot ? await readWorkspacePageRoutes(workspaceRoot) : [];
  const renderedPages = frontendRoot ? await readRenderedPages(workspaceRoot) : new Set<string>();
  const isRenderedView = frontendRoot
    ? createRenderedViewMatcher({ workspaceRoot, frontendRoot })
    : async () => false;

  const internalPort = await getOpenPort();
  const processRecord = startBackendProcess({
    workspaceRoot,
    backendEntry,
    port: internalPort,
    env: options.env,
    frontendRoot,
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
        pages: layers.pages,
        frontendRoot,
        backendOrigin,
        pageRoutes,
        renderedPages,
        isRenderedView,
      }),
    error: (error) => textResponse(500, error.message),
  });

  const failed = new Promise<void>((resolve) => {
    processRecord.exitPromise
      .then((code) => {
        if (stopping || processRecord.expectedExit) {
          return;
        }

        io.stderr.write(
          `[webstir-backend-deploy] backend runtime exited unexpectedly with code ${code ?? 'null'}.\n`,
        );
        void server.stop(true);
        resolve();
      })
      .catch((error) => {
        if (stopping) {
          return;
        }

        io.stderr.write(
          `[webstir-backend-deploy] backend runtime failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        void server.stop(true);
        resolve();
      });
  });

  const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;

  return {
    origin: `http://${displayHost}:${server.port}`,
    layers,
    failed,
    async stop(how: { readonly now?: boolean } = {}) {
      stopping = true;
      processRecord.expectedExit = true;
      const exited = processRecord.exitPromise.catch(() => undefined);
      if (how.now) {
        await server.stop(true);
        processRecord.child.kill('SIGKILL');
        await exited;
        return;
      }
      // Requests in flight finish here first, since each is one the app server is answering.
      // The limit is the one the app server reads: its environment, then the app's .env files.
      const limit = shutdownTimeoutMs({
        ...readEnvFiles(workspaceRoot),
        ...definedOnly({ ...process.env, ...options.env }),
      });
      await drainServer(server, limit);
      processRecord.child.kill('SIGTERM');
      // The app server bounds its own waits, then closes its database, which may be taking a
      // snapshot. That is waited for; whatever runs this process decides when it has been too long.
      await exited;
    },
  };
}

async function handlePublishedWorkspaceRequest(options: {
  readonly request: Request;
  readonly pages: boolean;
  readonly frontendRoot?: string;
  readonly backendOrigin: string;
  readonly pageRoutes: readonly PageRoute[];
  readonly renderedPages: ReadonlySet<string>;
  readonly isRenderedView: (pathname: string) => Promise<boolean>;
}): Promise<Response> {
  const requestUrl = new URL(options.request.url);
  const pathname = requestUrl.pathname;

  if (!options.pages) {
    return await proxyRequest(options.request, requestUrl, pathname, options.backendOrigin, false);
  }

  if (shouldProxyToBackend(options.request, pathname) || (await options.isRenderedView(pathname))) {
    const proxyPath = getFullWorkspaceProxyPath(pathname);
    return await proxyRequest(options.request, requestUrl, proxyPath, options.backendOrigin, true);
  }

  if (!options.frontendRoot) {
    return textResponse(500, 'Published frontend output is not available.');
  }

  return await servePublishedStaticFile(options.request, options.frontendRoot, {
    pageRoutes: options.pageRoutes,
    renderedPages: options.renderedPages,
  });
}
