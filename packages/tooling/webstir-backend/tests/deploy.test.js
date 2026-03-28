import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { backendProvider, startPublishedWorkspaceServer } from '../dist/index.js';

test('deploy cli is emitted with a Bun shebang', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.join(here, '..', 'dist', 'deploy-cli.js');
  const source = await fs.readFile(cliPath, 'utf8');

  assert.match(source, /^#!\/usr\/bin\/env bun/m);
});

test('deploy cli prints usage', () => {
  const cliPath = path.join(getPackageRoot(), 'dist', 'deploy-cli.js');
  const result = Bun.spawnSync({
    cmd: ['bun', cliPath, '--help'],
    cwd: getPackageRoot(),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  assert.equal(result.exitCode, 0);
  assert.match(new TextDecoder().decode(result.stdout), /Usage: webstir-backend-deploy/);
});

test('published deploy serves frontend assets and proxies backend routes for full workspaces', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

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
  const server = await startPublishedWorkspaceServer({
    workspaceRoot: workspace,
    port,
    io: quietIo,
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

    const redirectResponse = await fetch(`${server.origin}/api/deploy/redirect`, {
      redirect: 'manual',
    });
    assert.equal(redirectResponse.status, 303);
    assert.equal(redirectResponse.headers.get('location'), '/api/deploy/check');
  } finally {
    await server.stop();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('published deploy proxies api workspaces without a frontend host', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  const workspace = await createTempWorkspace('webstir-backend-deploy-api-');
  await buildRuntimeWorkspace(workspace, 'api');

  const port = await getOpenPort();
  const server = await startPublishedWorkspaceServer({
    workspaceRoot: workspace,
    port,
    io: quietIo,
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
});

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
  const assets = await backendProvider.getScaffoldAssets();

  for (const asset of assets) {
    const normalized = asset.targetPath.replace(/\\/g, '/');
    if (!normalized.includes('src/backend/')) {
      continue;
    }

    const target = path.join(workspace, asset.targetPath);
    await copyFile(asset.sourcePath, target);
  }
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
  await linkWorkspaceNodeModules(workspace);
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name: `@demo/${mode}-deploy`,
        version: '0.1.0',
        type: 'module',
        webstir: {
          mode,
        },
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
}

function createModuleSource(mode) {
  return `const routes = [
  {
    definition: {
      name: 'deployCheck',
      method: 'GET',
      path: '/deploy/check'
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
      path: '/deploy/redirect'
    },
    handler: async () => ({
      status: 303,
      redirect: {
        location: '/deploy/check'
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

const quietIo = {
  stdout: {
    write() {},
  },
  stderr: {
    write() {},
  },
};
