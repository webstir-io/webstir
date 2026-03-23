import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { createBackendTestHarness } from '../src/testing/index.js';

async function createTempDir(prefix) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeHarnessFixture(
  workspace,
  {
    entryPath = path.join(workspace, 'build', 'backend', 'index.js'),
    manifestPath = path.join(workspace, '.webstir', 'backend-manifest.json'),
    manifest = { name: '@demo/backend', version: '0.0.1', routes: [] },
  } = {},
) {
  await fs.mkdir(path.dirname(entryPath), { recursive: true });
  await fs.writeFile(
    entryPath,
    "console.log('API server running');\nsetInterval(() => {}, 1000);\n",
    'utf8',
  );
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
}

async function canListenOnTcp() {
  return await new Promise((resolve) => {
    const server = net.createServer();
    const settle = (value) => {
      server.removeAllListeners();
      server.close(() => resolve(value));
    };
    server.once('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        resolve(false);
        return;
      }
      resolve(false);
    });
    server.listen(0, '127.0.0.1', () => settle(true));
  });
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

test('createBackendTestHarness resolves WORKSPACE_ROOT when WEBSTIR_WORKSPACE_ROOT is unset', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  const workspace = await createTempDir('webstir-backend-harness-workspace-');
  const alternateCwd = await createTempDir('webstir-backend-harness-cwd-');
  const port = await getOpenPort();
  await writeHarnessFixture(workspace);

  const previousWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const previousWebstirWorkspaceRoot = process.env.WEBSTIR_WORKSPACE_ROOT;
  const previousCwd = process.cwd();
  let harness;

  try {
    process.env.WORKSPACE_ROOT = workspace;
    delete process.env.WEBSTIR_WORKSPACE_ROOT;
    process.chdir(alternateCwd);

    harness = await createBackendTestHarness({ port });

    assert.equal(harness.context.env.WORKSPACE_ROOT, workspace);
    assert.match(harness.context.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/?$/);
  } finally {
    await harness?.stop();
    process.chdir(previousCwd);
    if (previousWorkspaceRoot === undefined) {
      delete process.env.WORKSPACE_ROOT;
    } else {
      process.env.WORKSPACE_ROOT = previousWorkspaceRoot;
    }
    if (previousWebstirWorkspaceRoot === undefined) {
      delete process.env.WEBSTIR_WORKSPACE_ROOT;
    } else {
      process.env.WEBSTIR_WORKSPACE_ROOT = previousWebstirWorkspaceRoot;
    }
  }
});

test('createBackendTestHarness resolves WEBSTIR_WORKSPACE_ROOT from env overrides outside the workspace cwd', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  const workspace = await createTempDir('webstir-backend-harness-env-workspace-');
  const alternateCwd = await createTempDir('webstir-backend-harness-env-cwd-');
  const port = await getOpenPort();
  await writeHarnessFixture(workspace, {
    entryPath: path.join(workspace, 'custom', 'backend', 'index.js'),
    manifestPath: path.join(workspace, '.webstir', 'custom-backend-manifest.json'),
    manifest: {
      name: '@demo/env-harness',
      version: '1.2.3',
      routes: [{ path: '/env', method: 'GET' }],
    },
  });

  const previousCwd = process.cwd();
  let harness;

  try {
    process.chdir(alternateCwd);

    harness = await createBackendTestHarness({
      port,
      env: {
        WEBSTIR_WORKSPACE_ROOT: workspace,
        WEBSTIR_BACKEND_BUILD_ROOT: 'custom/backend',
        WEBSTIR_BACKEND_TEST_MANIFEST: '.webstir/custom-backend-manifest.json',
      },
    });

    assert.equal(harness.context.env.WORKSPACE_ROOT, workspace);
    assert.equal(harness.context.manifest?.name, '@demo/env-harness');
    assert.equal(harness.context.routes[0]?.path, '/env');
    assert.match(harness.context.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/?$/);
  } finally {
    await harness?.stop();
    process.chdir(previousCwd);
  }
});

test('createBackendTestHarness resolves option-based relative entry and manifest paths outside the workspace cwd', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  const workspace = await createTempDir('webstir-backend-harness-options-workspace-');
  const alternateCwd = await createTempDir('webstir-backend-harness-options-cwd-');
  const port = await getOpenPort();
  await writeHarnessFixture(workspace, {
    entryPath: path.join(workspace, 'artifacts', 'backend', 'server.js'),
    manifestPath: path.join(workspace, 'artifacts', 'backend', 'manifest.json'),
    manifest: {
      name: '@demo/options-harness',
      version: '4.5.6',
      routes: [{ path: '/options', method: 'POST' }],
    },
  });

  const previousCwd = process.cwd();
  let harness;

  try {
    process.chdir(alternateCwd);

    harness = await createBackendTestHarness({
      workspaceRoot: workspace,
      buildRoot: 'artifacts/backend',
      entry: 'artifacts/backend/server.js',
      manifestPath: 'artifacts/backend/manifest.json',
      port,
    });

    assert.equal(harness.context.env.WORKSPACE_ROOT, workspace);
    assert.equal(harness.context.manifest?.name, '@demo/options-harness');
    assert.equal(harness.context.routes[0]?.path, '/options');
    assert.match(harness.context.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/?$/);
  } finally {
    await harness?.stop();
    process.chdir(previousCwd);
  }
});
