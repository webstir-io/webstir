import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build as esbuild } from 'esbuild';

import { backendProvider } from '../dist/index.js';

async function createTempWorkspace(prefix = 'webstir-backend-migrate-') {
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
        type: 'module',
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function compileTemplateDbFiles(workspace) {
  await esbuild({
    entryPoints: [
      path.join(workspace, 'src', 'backend', 'env.ts'),
      path.join(workspace, 'src', 'backend', 'db', 'connection.ts'),
      path.join(workspace, 'src', 'backend', 'db', 'migrate.ts'),
    ],
    bundle: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outdir: path.join(workspace, 'build', 'backend'),
    outbase: path.join(workspace, 'src', 'backend'),
    logLevel: 'silent',
  });
}

async function writeBuiltMigration(workspace, file, source) {
  const target = path.join(workspace, 'build', 'backend', 'db', 'migrations', file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, source, 'utf8');
}

async function runMigrate(workspace, args = [], env = {}) {
  const child = spawn(
    'bun',
    [path.join(workspace, 'build', 'backend', 'db', 'migrate.js'), ...args],
    {
      cwd: workspace,
      env: {
        ...process.env,
        DATABASE_URL: `file:${path.join(workspace, 'data', 'test.sqlite')}`,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

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

  return { exitCode, stdout, stderr };
}

async function prepareWorkspace(name) {
  const workspace = await createTempWorkspace();
  await seedBackendWorkspace(workspace, name);
  await compileTemplateDbFiles(workspace);
  return workspace;
}

test('migration runner rejects unsafe DATABASE_MIGRATIONS_TABLE values', async () => {
  const workspace = await prepareWorkspace('@demo/migrate-table-validation');

  const result = await runMigrate(workspace, ['--status'], {
    DATABASE_MIGRATIONS_TABLE: '_webstir_migrations; DROP TABLE users',
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /DATABASE_MIGRATIONS_TABLE must be a single SQL identifier/);
});

test('migration runner rejects duplicate migration ids before running', async () => {
  const workspace = await prepareWorkspace('@demo/migrate-duplicate-ids');
  await writeBuiltMigration(
    workspace,
    '0001-first.js',
    `export const id = 'duplicate';
     export async function up() {}`,
  );
  await writeBuiltMigration(
    workspace,
    '0002-second.js',
    `export const id = 'duplicate';
     export async function up() {}`,
  );

  const result = await runMigrate(workspace, ['--list']);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /Duplicate migration id\(s\): duplicate/);
});

test('migration runner rolls back failed up migrations and leaves them pending', async () => {
  const workspace = await prepareWorkspace('@demo/migrate-failed-up');
  await writeBuiltMigration(
    workspace,
    '0001-fails.js',
    `export const id = '0001_fails';
     export async function up(ctx) {
       await ctx.sql('CREATE TABLE failed_probe (id TEXT PRIMARY KEY)');
       await ctx.sql('INSERT INTO failed_probe (id) VALUES (?)', ['before-error']);
       throw new Error('expected migration failure');
     }`,
  );

  const failed = await runMigrate(workspace);
  assert.equal(failed.exitCode, 1);
  assert.match(failed.stdout, /Applying 0001_fails/);
  assert.match(failed.stderr, /rolled back and was not recorded as applied/);

  const status = await runMigrate(workspace, ['--status']);
  assert.equal(status.exitCode, 0);
  assert.match(status.stdout, /Applied: 0/);
  assert.match(status.stdout, /Pending: 1/);
  assert.match(status.stdout, /pending 0001_fails/);

  await writeBuiltMigration(
    workspace,
    '0001-fails.js',
    `export const id = '0001_fails';
     export async function up(ctx) {
       await ctx.sql('CREATE TABLE failed_probe (id TEXT PRIMARY KEY)');
       await ctx.sql('INSERT INTO failed_probe (id) VALUES (?)', ['after-retry']);
     }`,
  );

  const recovered = await runMigrate(workspace);
  assert.equal(recovered.exitCode, 0, recovered.stderr);
});

test('migration runner status reports applied and pending local migrations', async () => {
  const workspace = await prepareWorkspace('@demo/migrate-status');
  await writeBuiltMigration(
    workspace,
    '0001-applied.js',
    `export const id = '0001_applied';
     export async function up(ctx) {
       await ctx.sql('CREATE TABLE applied_probe (id TEXT PRIMARY KEY)');
     }`,
  );
  await writeBuiltMigration(
    workspace,
    '0002-pending.js',
    `export const id = '0002_pending';
     export async function up(ctx) {
       await ctx.sql('CREATE TABLE pending_probe (id TEXT PRIMARY KEY)');
     }`,
  );

  const applied = await runMigrate(workspace, ['--steps', '1']);
  assert.equal(applied.exitCode, 0, applied.stderr);

  const status = await runMigrate(workspace, ['--status']);
  assert.equal(status.exitCode, 0);
  assert.match(status.stdout, /Status for _webstir_migrations/);
  assert.match(status.stdout, /Applied: 1/);
  assert.match(status.stdout, /Pending: 1/);
  assert.match(status.stdout, /pending 0002_pending/);
});

test('migration runner keeps records and rolls back failed down migrations', async () => {
  const workspace = await prepareWorkspace('@demo/migrate-failed-down');
  await writeBuiltMigration(
    workspace,
    '0001-reversible.js',
    `export const id = '0001_reversible';
     export async function up(ctx) {
       await ctx.sql('CREATE TABLE reversible_probe (id TEXT PRIMARY KEY)');
     }
     export async function down(ctx) {
       await ctx.sql('DROP TABLE reversible_probe');
       throw new Error('expected down failure');
     }`,
  );

  const applied = await runMigrate(workspace);
  assert.equal(applied.exitCode, 0, applied.stderr);

  const failed = await runMigrate(workspace, ['--down']);
  assert.equal(failed.exitCode, 1);
  assert.match(failed.stdout, /Reverting 0001_reversible/);
  assert.match(failed.stderr, /record was kept so it can be retried/);

  const stillApplied = await runMigrate(workspace, ['--status']);
  assert.equal(stillApplied.exitCode, 0);
  assert.match(stillApplied.stdout, /Applied: 1/);
  assert.match(stillApplied.stdout, /Pending: 0/);

  await writeBuiltMigration(
    workspace,
    '0001-reversible.js',
    `export const id = '0001_reversible';
     export async function up(ctx) {
       await ctx.sql('CREATE TABLE reversible_probe (id TEXT PRIMARY KEY)');
     }
     export async function down(ctx) {
       await ctx.sql('DROP TABLE reversible_probe');
     }`,
  );

  const recovered = await runMigrate(workspace, ['--down']);
  assert.equal(recovered.exitCode, 0, recovered.stderr);

  const finalStatus = await runMigrate(workspace, ['--status']);
  assert.equal(finalStatus.exitCode, 0);
  assert.match(finalStatus.stdout, /Applied: 0/);
  assert.match(finalStatus.stdout, /Pending: 1/);
});
