import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { backendProvider, startPublishedWorkspaceServer } from '../dist/index.js';
import { scaffoldAssets } from './support/scaffold.js';

const tcpListenAvailable = await canListenOnTcp();

test('deploy cli is emitted with a Bun shebang', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.join(here, '..', 'dist', 'deploy-cli.js');
  const source = await fs.readFile(cliPath, 'utf8');

  assert.match(source, /^#!\/usr\/bin\/env bun/m);
});

test('deploy cli prints usage', async () => {
  const cliPath = path.join(getPackageRoot(), 'dist', 'deploy-cli.js');
  // Never a blocking spawn: in a bun test worker one has waited forever for a child that had exited.
  const child = Bun.spawn({
    cmd: ['bun', cliPath, '--help'],
    cwd: getPackageRoot(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  assert.equal(exitCode, 0);
  assert.match(stdout, /Usage: webstir-backend-deploy/);
});

test('published deploy refuses an app recorded with pages whose frontend output is missing', async () => {
  const workspace = await createTempWorkspace('webstir-backend-deploy-missing-pages-');
  await buildRuntimeWorkspace(workspace, 'full');
  // What publish records, in an image that left out dist/.
  await fs.writeFile(
    path.join(workspace, 'build', 'published-layers.json'),
    JSON.stringify({ pages: true, server: true }),
    'utf8',
  );

  await assert.rejects(
    startPublishedWorkspaceServer({ workspaceRoot: workspace, port: 0 }),
    /published frontend output/,
  );
});

test.skipIf(!tcpListenAvailable)(
  'published deploy serves frontend assets and proxies backend routes for full workspaces',
  async () => {
    const workspace = await createTempWorkspace('webstir-backend-deploy-full-');
    await buildRuntimeWorkspace(workspace, 'full');
    await writePublishedFrontendDocument(
      workspace,
      'home',
      '<!DOCTYPE html><html><body>Home</body></html>',
    );
    await writePublishedFrontendDocument(
      workspace,
      'about',
      '<!DOCTYPE html><html><body>About</body></html>',
    );

    const port = await getOpenPort();
    const server = await startWithCapturedOutput({
      workspaceRoot: workspace,
      port,
    });

    try {
      const homeResponse = await fetch(`${server.origin}/`);
      assert.equal(homeResponse.status, 200);
      assert.match(await homeResponse.text(), /Home/);
      assert.match(String(homeResponse.headers.get('cache-control')), /no-store/);

      const aboutResponse = await fetch(`${server.origin}/about`);
      assert.equal(aboutResponse.status, 200);
      assert.match(await aboutResponse.text(), /About/);

      const apiResponse = await fetch(`${server.origin}/api/deploy/check`);
      assert.equal(apiResponse.status, 200);
      assert.deepEqual(await apiResponse.json(), { ok: true, mode: 'full' });

      const readyResponse = await fetch(`${server.origin}/readyz`);
      assert.equal(readyResponse.status, 200);
      const readyPayload = await readyResponse.json();
      assert.equal(readyPayload.status, 'ready');
      assert.equal(readyPayload.manifest?.routes, 2);

      const healthResponse = await fetch(`${server.origin}/healthz`);
      assert.equal(healthResponse.status, 200);
      assert.equal((await healthResponse.json()).ok, true);

      const metricsResponse = await fetch(`${server.origin}/metrics`);
      assert.equal(metricsResponse.status, 200);
      const metricsPayload = await metricsResponse.json();
      assert.equal(metricsPayload.enabled, true);
      assert.ok(metricsPayload.totalRequests >= 1);
      assert.ok((metricsPayload.byStatus?.['200'] ?? 0) >= 1);

      const reportResponse = await fetch(`${server.origin}/client-errors`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'error', message: 'boom', correlationId: 'c-1' }),
      });
      assert.equal(reportResponse.status, 204);

      const refusedReport = await fetch(`${server.origin}/client-errors`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'boom',
      });
      assert.equal(refusedReport.status, 415);

      const redirectResponse = await fetch(`${server.origin}/api/deploy/redirect`, {
        redirect: 'manual',
      });
      assert.equal(redirectResponse.status, 303);
      assert.equal(redirectResponse.headers.get('location'), '/api/deploy/check');
    } finally {
      await server.stop();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  },
);

test.skipIf(!tcpListenAvailable)(
  'published deploy proxies api workspaces without a frontend host',
  async () => {
    const workspace = await createTempWorkspace('webstir-backend-deploy-api-');
    await buildRuntimeWorkspace(workspace, 'api');

    const port = await getOpenPort();
    const server = await startWithCapturedOutput({
      workspaceRoot: workspace,
      port,
    });

    try {
      const apiResponse = await fetch(`${server.origin}/deploy/check`);
      assert.equal(apiResponse.status, 200);
      assert.deepEqual(await apiResponse.json(), { ok: true, mode: 'api' });

      const healthResponse = await fetch(`${server.origin}/healthz`);
      assert.equal(healthResponse.status, 200);
      assert.equal((await healthResponse.json()).ok, true);

      const metricsResponse = await fetch(`${server.origin}/metrics`);
      assert.equal(metricsResponse.status, 200);
      assert.equal((await metricsResponse.json()).enabled, true);

      const redirectResponse = await fetch(`${server.origin}/deploy/redirect`, {
        redirect: 'manual',
      });
      assert.equal(redirectResponse.status, 303);
      assert.equal(redirectResponse.headers.get('location'), '/deploy/check');

      const missingResponse = await fetch(`${server.origin}/missing`);
      assert.equal(missingResponse.status, 404);
    } finally {
      await server.stop();
      await fs.rm(workspace, { recursive: true, force: true });
    }
  },
);

async function createTempWorkspace(prefix) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function hydrateBackendScaffold(workspace) {
  const assets = scaffoldAssets();

  for (const asset of assets) {
    const normalized = asset.targetPath.replace(/\\/g, '/');
    if (!normalized.includes('src/backend/')) {
      continue;
    }

    const target = path.join(workspace, asset.targetPath);
    await copyFile(asset.sourcePath, target);
  }
}

// The scaffold's server with bearer auth turned on, as an API with its own identity provider does.
const BEARER_AUTH_ENTRY = `import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDefaultBunBackendBootstrap, startBunBackend } from '@webstir-io/webstir-backend';
import { resolveBearerAuth } from '@webstir-io/webstir-backend/auth/bearer';

export async function start() {
  await startBunBackend(
    createDefaultBunBackendBootstrap({
      importMetaUrl: import.meta.url,
      resolveRequestAuth: (request) => resolveBearerAuth(request),
    }),
  );
}

const entrypointPath = process.argv[1];
if (entrypointPath && path.resolve(entrypointPath) === fileURLToPath(import.meta.url)) {
  start().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
`;

async function useBearerAuthEntry(workspace) {
  await fs.writeFile(path.join(workspace, 'src', 'backend', 'index.ts'), BEARER_AUTH_ENTRY, 'utf8');
}

function getLocalBinPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  return path.join(pkgRoot, 'node_modules', '.bin');
}

function getPackageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

async function linkWorkspaceNodeModules(workspace) {
  const packageRoot = getPackageRoot();
  const source = path.join(packageRoot, 'node_modules');
  const target = path.join(workspace, 'node_modules');
  await fs.mkdir(target, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '@webstir-io') {
      continue;
    }

    await createSymlinkIfMissing(
      path.join(source, entry.name),
      path.join(target, entry.name),
      entry.isDirectory() ? 'dir' : 'file',
    );
  }

  const scopeSource = path.join(source, '@webstir-io');
  const scopeTarget = path.join(target, '@webstir-io');
  await fs.mkdir(scopeTarget, { recursive: true });
  const scopeEntries = await fs.readdir(scopeSource, { withFileTypes: true });
  for (const entry of scopeEntries) {
    await createSymlinkIfMissing(
      path.join(scopeSource, entry.name),
      path.join(scopeTarget, entry.name),
      entry.isDirectory() ? 'dir' : 'file',
    );
  }

  await createSymlinkIfMissing(packageRoot, path.join(scopeTarget, 'webstir-backend'), 'dir');
}

async function createSymlinkIfMissing(source, target, type) {
  try {
    await fs.symlink(source, target, type);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return;
    }

    throw error;
  }
}

async function buildRuntimeWorkspace(workspace, mode) {
  await hydrateBackendScaffold(workspace);
  await useBearerAuthEntry(workspace);
  await linkWorkspaceNodeModules(workspace);
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: `@demo/${mode}-deploy`,
        version: '0.1.0',
        type: 'module',
        webstir: {},
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(
    path.join(workspace, 'src', 'backend', 'module.ts'),
    createModuleSource(mode),
    'utf8',
  );

  await backendProvider.build({
    workspaceRoot: workspace,
    env: {
      WEBSTIR_MODULE_MODE: 'publish',
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
      PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
    },
    incremental: false,
  });
  // A deploy image carries only the published output (see the Docker .dockerignore), not src/.
  await fs.rm(path.join(workspace, 'src'), { recursive: true, force: true });
}

function createModuleSource(mode) {
  const routePrefix = mode === 'full' ? '/api' : '';
  return `const routes = [
  {
    definition: {
      name: 'deployCheck',
      method: 'GET',
      path: '${routePrefix}/deploy/check'
    },
    handler: async () => ({
      status: 200,
      body: {
        ok: true,
        mode: ${JSON.stringify(mode)}
      }
    })
  },
  {
    definition: {
      name: 'deployRedirect',
      method: 'GET',
      path: '${routePrefix}/deploy/redirect'
    },
    handler: async () => ({
      status: 303,
      redirect: {
        location: '${routePrefix}/deploy/check'
      }
    })
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/${mode}-deploy',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
`;
}

async function writePublishedFrontendDocument(workspace, pageName, html) {
  const targetPath = path.join(workspace, 'dist', 'frontend', 'pages', pageName, 'index.html');
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, html, 'utf8');
}

async function getOpenPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate an open port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function canListenOnTcp() {
  return await new Promise((resolve) => {
    const server = net.createServer();
    const settle = (value) => {
      server.removeAllListeners();
      server.close(() => resolve(value));
    };

    server.once('error', () => settle(false));
    server.listen(0, '127.0.0.1', () => settle(true));
  });
}

async function startWithCapturedOutput(options) {
  let output = '';
  const stream = {
    write(chunk) {
      output += chunk;
    },
  };
  try {
    return await startPublishedWorkspaceServer({
      ...options,
      io: { stdout: stream, stderr: stream },
    });
  } catch (error) {
    throw new Error(`${error.message}\n${output}`, { cause: error });
  }
}
