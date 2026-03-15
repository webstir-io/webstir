import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';

import { backendProvider } from '../dist/index.js';

const config = {
  secret: 'test-session-secret',
  cookieName: 'webstir_session',
  secure: false,
  maxAgeSeconds: 60
};

const loginRoute = {
  form: {
    session: { write: true },
    flash: {
      publish: [{ key: 'signed-in', level: 'success', when: 'success' }]
    }
  }
};

const accountRoute = {
  session: { mode: 'optional' },
  flash: { consume: ['signed-in'] }
};

async function createTempWorkspace(prefix = 'webstir-backend-session-store-') {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function copyFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function seedBackendWorkspace(workspace, name) {
  const assets = await backendProvider.getScaffoldAssets();
  for (const asset of assets) {
    await copyFile(asset.sourcePath, path.join(workspace, asset.targetPath));
  }

  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '0.0.0',
        type: 'module'
      },
      null,
      2
    ),
    'utf8'
  );
}

async function linkWorkspacePackage(workspace) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const scopeRoot = path.join(workspace, 'node_modules', '@webstir-io');
  await fs.mkdir(scopeRoot, { recursive: true });
  await fs.symlink(packageRoot, path.join(scopeRoot, 'webstir-backend'), 'dir');
}

async function compileTemplateSessionFiles(workspace) {
  await esbuild({
    entryPoints: [
      path.join(workspace, 'src', 'backend', 'env.ts'),
      path.join(workspace, 'src', 'backend', 'session', 'sqlite.ts'),
      path.join(workspace, 'src', 'backend', 'session', 'store.ts'),
      path.join(workspace, 'src', 'backend', 'runtime', 'session.ts')
    ],
    bundle: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outdir: path.join(workspace, 'build', 'backend'),
    outbase: path.join(workspace, 'src', 'backend'),
    logLevel: 'silent'
  });
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function extractCookieHeader(setCookie) {
  assert.ok(setCookie, 'expected a session cookie');
  return String(setCookie).split(';')[0];
}

async function importCompiledModule(filePath) {
  return await import(`${pathToFileURL(filePath).href}?t=${Date.now()}-${Math.random()}`);
}

async function runSqliteSessionProbe(workspace, { cwd = workspace, env = {} } = {}) {
  const sessionStoreUrl = pathToFileURL(path.join(workspace, 'build', 'backend', 'session', 'store.js')).href;
  const runtimeSessionUrl = pathToFileURL(path.join(workspace, 'build', 'backend', 'runtime', 'session.js')).href;
  const script = `
    const [{ sessionStore }, { prepareSessionState }] = await Promise.all([
      import(${JSON.stringify(sessionStoreUrl)}),
      import(${JSON.stringify(runtimeSessionUrl)})
    ]);

    const config = {
      secret: 'test-session-secret',
      cookieName: 'webstir_session',
      secure: false,
      maxAgeSeconds: 60
    };
    const loginRoute = {
      form: {
        session: { write: true },
        flash: {
          publish: [{ key: 'signed-in', level: 'success', when: 'success' }]
        }
      }
    };
    const accountRoute = {
      session: { mode: 'optional' },
      flash: { consume: ['signed-in'] }
    };
    const created = prepareSessionState({
      cookies: '',
      route: loginRoute,
      config,
      store: sessionStore
    });
    const createdCommit = created.commit({
      session: {
        userId: 'ada@example.com',
        data: { email: 'ada@example.com' }
      },
      route: loginRoute,
      result: {
        status: 303,
        redirect: { location: '/session/account' }
      }
    });
    const cookie = String(createdCommit.setCookie).split(';')[0];
    const read = prepareSessionState({
      cookies: cookie,
      route: accountRoute,
      config,
      store: sessionStore
    });
    console.log(JSON.stringify({
      userId: read.session?.userId ?? null,
      flash: read.flash.map((message) => ({ key: message.key, level: message.level }))
    }));
  `;
  const child = spawn('bun', ['--eval', script], {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve) => {
    child.once('close', resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`Session probe failed (exit ${exitCode}).\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.startsWith('{'));
  if (!line) {
    throw new Error(`Session probe did not emit JSON.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return JSON.parse(line);
}

test('scaffold session store defaults to in-memory storage', async () => {
  const workspace = await createTempWorkspace('webstir-backend-session-memory-');
  await seedBackendWorkspace(workspace, '@demo/session-memory');
  await linkWorkspacePackage(workspace);
  await compileTemplateSessionFiles(workspace);

  const previousEnv = snapshotEnv([
    'WORKSPACE_ROOT',
    'WEBSTIR_WORKSPACE_ROOT',
    'SESSION_STORE_DRIVER',
    'SESSION_STORE_URL'
  ]);
  const previousSqliteTarget = globalThis.__webstirSqliteTarget;

  try {
    delete process.env.WORKSPACE_ROOT;
    delete process.env.WEBSTIR_WORKSPACE_ROOT;
    delete process.env.SESSION_STORE_DRIVER;
    delete process.env.SESSION_STORE_URL;
    delete globalThis.__webstirSqliteTarget;

    const { sessionStore } = await importCompiledModule(path.join(workspace, 'build', 'backend', 'session', 'store.js'));
    const { prepareSessionState } = await importCompiledModule(path.join(workspace, 'build', 'backend', 'runtime', 'session.js'));

    const created = prepareSessionState({
      cookies: '',
      route: loginRoute,
      config,
      store: sessionStore
    });
    const createdCommit = created.commit({
      session: {
        userId: 'ada@example.com'
      },
      route: loginRoute,
      result: {
        status: 303,
        redirect: { location: '/session/account' }
      }
    });

    const read = prepareSessionState({
      cookies: extractCookieHeader(createdCommit.setCookie),
      route: accountRoute,
      config,
      store: sessionStore
    });

    assert.equal(read.session?.userId, 'ada@example.com');
    assert.equal(globalThis.__webstirSqliteTarget, undefined);
  } finally {
    restoreEnv(previousEnv);
    if (previousSqliteTarget === undefined) {
      delete globalThis.__webstirSqliteTarget;
    } else {
      globalThis.__webstirSqliteTarget = previousSqliteTarget;
    }
  }
});

test('scaffold session store resolves sqlite paths from the workspace root outside the workspace cwd', async () => {
  const workspace = await createTempWorkspace('webstir-backend-session-sqlite-');
  const alternateCwd = await createTempWorkspace('webstir-backend-session-sqlite-cwd-');
  await seedBackendWorkspace(workspace, '@demo/session-sqlite');
  await linkWorkspacePackage(workspace);
  await compileTemplateSessionFiles(workspace);

  const result = await runSqliteSessionProbe(workspace, {
    cwd: alternateCwd,
    env: {
      WORKSPACE_ROOT: '   ',
      WEBSTIR_WORKSPACE_ROOT: workspace,
      SESSION_STORE_DRIVER: 'sqlite',
      SESSION_STORE_URL: 'file:./data/session-store.sqlite'
    }
  });

  assert.equal(result.userId, 'ada@example.com');
  assert.deepEqual(result.flash, [{ key: 'signed-in', level: 'success' }]);
  assert.equal(
    await fs
      .access(path.join(workspace, 'data', 'session-store.sqlite'))
      .then(() => true)
      .catch(() => false),
    true
  );
  assert.equal(
    await fs
      .access(path.join(alternateCwd, 'data', 'session-store.sqlite'))
      .then(() => true)
      .catch(() => false),
    false
  );
});
