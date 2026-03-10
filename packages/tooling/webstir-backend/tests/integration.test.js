import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { backendProvider } from '../dist/index.js';

async function createTempWorkspace(prefix = 'webstir-backend-workspace-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
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
  const target = path.join(workspace, 'node_modules');
  const source = path.join(getPackageRoot(), 'node_modules');
  await fs.symlink(source, target, 'dir');
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

async function startBuiltServer(workspace, port) {
  const child = spawn('node', ['--input-type=module', '--eval', "import('./build/backend/index.js').then((mod) => mod.start())"], {
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    await Promise.race([
      waitFor(async () => await canConnectToPort(port), 10000, 50),
      new Promise((_, reject) => {
        child.once('exit', (code, signal) => {
          reject(new Error(`Backend server exited before readiness (code=${code ?? 'null'} signal=${signal ?? 'null'}).`));
        });
      })
    ]);
  } catch (error) {
    child.kill('SIGTERM');
    await onceExit(child);
    throw new Error(`Backend server did not become ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    async stop() {
      child.kill('SIGTERM');
      await onceExit(child);
    }
  };
}

async function onceExit(child) {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => child.once('exit', resolve));
}

async function canConnectToPort(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const settle = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(200, () => settle(false));
  });
}

async function waitFor(checkFn, timeoutMs = 5000, pollMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkFn()) {
      return;
    }
    await delay(pollMs);
  }
  throw new Error('waitFor timed out');
}

test('build mode produces transpiled output and manifest', async () => {
  const workspace = await createTempWorkspace();
  await hydrateBackendScaffold(workspace);

  const bin = getLocalBinPath();
  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const buildRoot = path.join(workspace, 'build', 'backend');
  const outFile = path.join(buildRoot, 'index.js');
  assert.equal(fssync.existsSync(outFile), true, 'expected build/backend/index.js to exist');

  assert.ok(Array.isArray(result.manifest.entryPoints));
  assert.ok(result.manifest.entryPoints.some((e) => e.endsWith('index.js')));
});

test('publish mode bundles output and manifest has entry', async () => {
  const workspace = await createTempWorkspace();
  await hydrateBackendScaffold(workspace);

  const bin = getLocalBinPath();
  const env = {
    WEBSTIR_MODULE_MODE: 'publish',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const buildRoot = path.join(workspace, 'build', 'backend');
  const outFile = path.join(buildRoot, 'index.js');
  assert.equal(fssync.existsSync(outFile), true, 'expected build/backend/index.js to exist');

  assert.ok(result.manifest.entryPoints.length >= 1);
});

test('publish mode emits sourcemaps when opt-in flag is set', async () => {
  const workspace = await createTempWorkspace();
  await hydrateBackendScaffold(workspace);

  const bin = getLocalBinPath();
  const env = {
    WEBSTIR_MODULE_MODE: 'publish',
    WEBSTIR_BACKEND_SOURCEMAPS: 'on',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const buildRoot = path.join(workspace, 'build', 'backend');
  const mapFile = path.join(buildRoot, 'index.js.map');
  assert.equal(fssync.existsSync(mapFile), true, 'expected build/backend/index.js.map to exist');
  assert.ok(
    result.artifacts.some((artifact) => artifact.path.endsWith('index.js.map') && artifact.type === 'asset'),
    'expected index.js.map to be included as an asset artifact'
  );
});

test('built backend server honors redirect and fragment route responses', async () => {
  const workspace = await createTempWorkspace('webstir-backend-runtime-');
  await hydrateBackendScaffold(workspace);
  await linkWorkspaceNodeModules(workspace);
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module' }, null, 2), 'utf8');

  const moduleSource = `const routes = [
  {
    definition: {
      name: 'redirectRoute',
      method: 'POST',
      path: '/actions/redirect',
      interaction: 'mutation',
      form: { contentType: 'application/x-www-form-urlencoded' }
    },
    handler: async (ctx) => ({
      status: 303,
      redirect: {
        location: \`/done?name=\${encodeURIComponent(String(ctx.body?.name ?? 'unknown'))}\`
      }
    })
  },
  {
    definition: {
      name: 'fragmentRoute',
      method: 'POST',
      path: '/actions/fragment',
      interaction: 'mutation',
      form: { contentType: 'application/x-www-form-urlencoded' },
      fragment: { target: 'greeting', mode: 'replace' }
    },
    handler: async (ctx) => ({
      status: 200,
      fragment: {
        target: 'greeting',
        mode: 'replace',
        body: \`<p>Hello \${String(ctx.body?.name ?? 'world')}</p>\`
      }
    })
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/runtime',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
`;

  await fs.writeFile(path.join(workspace, 'src', 'backend', 'module.ts'), moduleSource, 'utf8');

  const buildEnv = {
    WEBSTIR_MODULE_MODE: 'publish',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`
  };
  await backendProvider.build({ workspaceRoot: workspace, env: buildEnv, incremental: false });

  const port = await getOpenPort();
  const server = await startBuiltServer(workspace, port);

  try {
    const redirectResponse = await fetch(`http://127.0.0.1:${port}/actions/redirect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'name=Webstir',
      redirect: 'manual'
    });

    assert.equal(redirectResponse.status, 303);
    assert.equal(redirectResponse.headers.get('location'), '/done?name=Webstir');

    const fragmentResponse = await fetch(`http://127.0.0.1:${port}/actions/fragment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'name=Webstir'
    });

    assert.equal(fragmentResponse.status, 200);
    assert.equal(fragmentResponse.headers.get('x-webstir-fragment-target'), 'greeting');
    assert.equal(fragmentResponse.headers.get('x-webstir-fragment-mode'), 'replace');
    assert.equal(fragmentResponse.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await fragmentResponse.text(), '<p>Hello Webstir</p>');
  } finally {
    await server.stop();
  }
});
