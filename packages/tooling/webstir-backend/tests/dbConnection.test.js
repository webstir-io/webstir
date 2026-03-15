import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';

import { backendProvider } from '../dist/index.js';

async function createTempWorkspace(prefix = 'webstir-backend-db-') {
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

async function writeBetterSqliteStub(workspace) {
  const moduleRoot = path.join(workspace, 'node_modules', 'better-sqlite3');
  await fs.mkdir(moduleRoot, { recursive: true });
  await fs.writeFile(
    path.join(moduleRoot, 'package.json'),
    JSON.stringify({ name: 'better-sqlite3', type: 'module', exports: './index.js' }, null, 2),
    'utf8'
  );
  await fs.writeFile(
    path.join(moduleRoot, 'index.js'),
    `export default class Database {
  constructor(filename) {
    globalThis.__webstirSqliteTarget = filename;
  }
  prepare() {
    return {
      all() { return []; },
      run() { return {}; }
    };
  }
  close() {}
}
`,
    'utf8'
  );
}

async function compileTemplateDbFiles(workspace) {
  await esbuild({
    entryPoints: [
      path.join(workspace, 'src', 'backend', 'env.ts'),
      path.join(workspace, 'src', 'backend', 'db', 'connection.ts')
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

async function assertSameResolvedPath(actual, expected) {
  const [resolvedActual, resolvedExpected] = await Promise.all([
    resolveComparablePath(actual),
    resolveComparablePath(expected)
  ]);
  assert.equal(resolvedActual, resolvedExpected);
}

async function resolveComparablePath(targetPath) {
  const directory = await fs.realpath(path.dirname(targetPath));
  return path.join(directory, path.basename(targetPath));
}

async function runConnectionProbe(workspace, { cwd = workspace, env = {} } = {}) {
  const entryUrl = pathToFileURL(path.join(workspace, 'build', 'backend', 'db', 'connection.js')).href;
  const script = `
    import(${JSON.stringify(entryUrl)}).then(async ({ createDatabaseClient }) => {
      const db = await createDatabaseClient();
      console.log(JSON.stringify({ target: globalThis.__webstirSqliteTarget ?? null }));
      await db.close();
    });
  `;
  const child = spawn('node', ['--input-type=module', '--eval', script], {
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
    throw new Error(`DB probe failed (exit ${exitCode}).\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => value.startsWith('{'));
  if (!line) {
    throw new Error(`DB probe did not emit JSON.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return JSON.parse(line);
}

test('createDatabaseClient resolves file: DATABASE_URL from WEBSTIR_WORKSPACE_ROOT outside the workspace cwd', async () => {
  const workspace = await createTempWorkspace('webstir-backend-db-env-root-');
  const alternateCwd = await createTempWorkspace('webstir-backend-db-env-root-cwd-');
  await seedBackendWorkspace(workspace, '@demo/db-env-root');
  await writeBetterSqliteStub(workspace);
  await compileTemplateDbFiles(workspace);

  const previousEnv = snapshotEnv(['WORKSPACE_ROOT', 'WEBSTIR_WORKSPACE_ROOT', 'DATABASE_URL']);

  try {
    const result = await runConnectionProbe(workspace, {
      cwd: alternateCwd,
      env: {
        WORKSPACE_ROOT: '   ',
        WEBSTIR_WORKSPACE_ROOT: workspace,
        DATABASE_URL: 'file:./data/env-root.sqlite'
      }
    });

    await assertSameResolvedPath(result.target, path.join(workspace, 'data', 'env-root.sqlite'));
  } finally {
    restoreEnv(previousEnv);
  }
});

test('createDatabaseClient resolves plain relative sqlite DATABASE_URL from module path outside the workspace cwd', async () => {
  const workspace = await createTempWorkspace('webstir-backend-db-infer-');
  const alternateCwd = await createTempWorkspace('webstir-backend-db-infer-cwd-');
  await seedBackendWorkspace(workspace, '@demo/db-infer');
  await writeBetterSqliteStub(workspace);
  await compileTemplateDbFiles(workspace);

  const previousEnv = snapshotEnv(['WORKSPACE_ROOT', 'WEBSTIR_WORKSPACE_ROOT', 'DATABASE_URL']);

  try {
    const result = await runConnectionProbe(workspace, {
      cwd: alternateCwd,
      env: {
        DATABASE_URL: './data/infer.sqlite'
      }
    });

    await assertSameResolvedPath(result.target, path.join(workspace, 'data', 'infer.sqlite'));
  } finally {
    restoreEnv(previousEnv);
  }
});

test('createDatabaseClient preserves absolute sqlite paths outside the workspace cwd', async () => {
  const workspace = await createTempWorkspace('webstir-backend-db-absolute-');
  const alternateCwd = await createTempWorkspace('webstir-backend-db-absolute-cwd-');
  const absoluteTarget = path.join(workspace, 'data', 'absolute.sqlite');
  await seedBackendWorkspace(workspace, '@demo/db-absolute');
  await writeBetterSqliteStub(workspace);
  await compileTemplateDbFiles(workspace);

  const previousEnv = snapshotEnv(['WORKSPACE_ROOT', 'WEBSTIR_WORKSPACE_ROOT', 'DATABASE_URL']);

  try {
    const result = await runConnectionProbe(workspace, {
      cwd: alternateCwd,
      env: {
        DATABASE_URL: `file:${absoluteTarget}`
      }
    });

    await assertSameResolvedPath(result.target, absoluteTarget);
  } finally {
    restoreEnv(previousEnv);
  }
});
