import { test } from 'node:test';
import assert from 'node:assert/strict';
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

async function writeBetterSqliteStub(workspace) {
  const moduleRoot = path.join(workspace, 'node_modules', 'better-sqlite3');
  await fs.mkdir(moduleRoot, { recursive: true });
  await fs.writeFile(
    path.join(moduleRoot, 'package.json'),
    JSON.stringify({ name: 'better-sqlite3', main: 'index.cjs' }, null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(moduleRoot, 'index.cjs'),
    `const stores = globalThis.__webstirSqliteStores ??= new Map();

class Statement {
  constructor(filename, sql) {
    this.filename = filename;
    this.sql = sql.replace(/\\s+/g, ' ').trim().toLowerCase();
  }

  run(params = []) {
    const values = Array.isArray(params) ? params : [params];
    const rows = stores.get(this.filename);
    if (this.sql.startsWith('create table') || this.sql.startsWith('create index')) {
      return;
    }
    if (this.sql.startsWith('delete from webstir_sessions where expires_at <= ?')) {
      const cutoff = String(values[0] ?? '');
      for (const [id, row] of rows.entries()) {
        if (String(row.expires_at) <= cutoff) {
          rows.delete(id);
        }
      }
      return;
    }
    if (this.sql.startsWith('insert into webstir_sessions')) {
      rows.set(String(values[0]), {
        id: String(values[0]),
        value: String(values[1]),
        flash: String(values[2]),
        created_at: String(values[3]),
        expires_at: String(values[4])
      });
      return;
    }
    if (this.sql.startsWith('delete from webstir_sessions where id = ?')) {
      rows.delete(String(values[0]));
      return;
    }
    throw new Error('Unsupported SQL in stub: ' + this.sql);
  }

  get(params = []) {
    const values = Array.isArray(params) ? params : [params];
    const rows = stores.get(this.filename);
    if (this.sql.startsWith('select id, value, flash, created_at as createdat, expires_at as expiresat from webstir_sessions where id = ?')) {
      const row = rows.get(String(values[0]));
      if (!row) {
        return undefined;
      }
      return {
        id: row.id,
        value: row.value,
        flash: row.flash,
        createdAt: row.created_at,
        expiresAt: row.expires_at
      };
    }
    throw new Error('Unsupported SQL in stub: ' + this.sql);
  }
}

class Database {
  constructor(filename) {
    globalThis.__webstirSqliteTarget = filename;
    this.filename = filename;
    if (!stores.has(filename)) {
      stores.set(filename, new Map());
    }
  }

  prepare(sql) {
    return new Statement(this.filename, sql);
  }

  close() {}
}

module.exports = Database;
module.exports.default = Database;
`,
    'utf8'
  );
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

async function assertSameResolvedPath(actual, expected) {
  const [resolvedActual, resolvedExpected] = await Promise.all([
    fs.realpath(path.dirname(actual)),
    fs.realpath(path.dirname(expected))
  ]);
  assert.equal(path.join(resolvedActual, path.basename(actual)), path.join(resolvedExpected, path.basename(expected)));
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
  await writeBetterSqliteStub(workspace);
  await compileTemplateSessionFiles(workspace);

  const previousEnv = snapshotEnv([
    'WORKSPACE_ROOT',
    'WEBSTIR_WORKSPACE_ROOT',
    'SESSION_STORE_DRIVER',
    'SESSION_STORE_URL'
  ]);
  const previousCwd = process.cwd();
  const previousSqliteTarget = globalThis.__webstirSqliteTarget;

  try {
    process.chdir(alternateCwd);
    process.env.WORKSPACE_ROOT = '   ';
    process.env.WEBSTIR_WORKSPACE_ROOT = workspace;
    process.env.SESSION_STORE_DRIVER = 'sqlite';
    process.env.SESSION_STORE_URL = 'file:./data/session-store.sqlite';
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
        userId: 'ada@example.com',
        data: { email: 'ada@example.com' }
      },
      route: loginRoute,
      result: {
        status: 303,
        redirect: { location: '/session/account' }
      }
    });

    await assertSameResolvedPath(
      globalThis.__webstirSqliteTarget,
      path.join(workspace, 'data', 'session-store.sqlite')
    );

    const read = prepareSessionState({
      cookies: extractCookieHeader(createdCommit.setCookie),
      route: accountRoute,
      config,
      store: sessionStore
    });

    assert.equal(read.session?.userId, 'ada@example.com');
    assert.deepEqual(
      read.flash.map((message) => ({ key: message.key, level: message.level })),
      [{ key: 'signed-in', level: 'success' }]
    );
  } finally {
    process.chdir(previousCwd);
    restoreEnv(previousEnv);
    if (previousSqliteTarget === undefined) {
      delete globalThis.__webstirSqliteTarget;
    } else {
      globalThis.__webstirSqliteTarget = previousSqliteTarget;
    }
  }
});
