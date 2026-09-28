import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyMigrations,
  numberPlaceholders,
  openDatabase,
  readAppMigrations,
  readMigrationStatus,
} from '../dist/db/index.js';

// SQLite always; Postgres too when TEST_DATABASE_URL names one (CI runs a service container).
const targets = [
  { name: 'sqlite', url: () => 'file:./data/test.sqlite' },
  ...(process.env.TEST_DATABASE_URL
    ? [{ name: 'postgres', url: () => process.env.TEST_DATABASE_URL }]
    : []),
];

async function withDatabase(target, run) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-db-'));
  const connection = await openDatabase(target.url(), { workspaceRoot });
  const table = `notes_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await run({ connection, table, workspaceRoot });
  } finally {
    await connection.exec(`DROP TABLE IF EXISTS ${table}`).catch(() => undefined);
    await connection.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

for (const target of targets) {
  test(`${target.name}: queries with ? placeholders, and transactions commit or roll back`, async () => {
    await withDatabase(target, async ({ connection: db, table }) => {
      await db.exec(
        `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL, at TEXT)`,
      );
      const when = new Date('2026-01-02T03:04:05.000Z');
      assert.deepEqual(
        await db.execute(`INSERT INTO ${table} (id, title, done, at) VALUES (?, ?, ?, ?)`, [
          1,
          "it's ? here",
          true,
          when,
        ]),
        { changes: 1 },
      );
      assert.deepEqual(await db.get(`SELECT title, done, at FROM ${table} WHERE id = ?`, [1]), {
        title: "it's ? here",
        done: 1,
        at: when.toISOString(),
      });
      assert.equal(await db.get(`SELECT id FROM ${table} WHERE id = ?`, [2]), undefined);

      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.execute(`INSERT INTO ${table} (id, title, done) VALUES (?, ?, ?)`, [2, 'b', 0]);
          throw new Error('undo');
        }),
        /undo/,
      );
      const kept = await db.transaction(async (tx) => {
        await tx.execute(`INSERT INTO ${table} (id, title, done) VALUES (?, ?, ?)`, [3, 'c', 0]);
        // A nested transaction rolls back alone.
        await tx
          .transaction(async (inner) => {
            await inner.execute(`INSERT INTO ${table} (id, title, done) VALUES (?, ?, ?)`, [
              4,
              'd',
              0,
            ]);
            throw new Error('inner');
          })
          .catch(() => undefined);
        // The connection itself, used inside the transaction, joins it rather than waiting on it.
        return await db.query(`SELECT id FROM ${table} ORDER BY id`);
      });
      assert.deepEqual(
        kept.map((row) => row.id),
        [1, 3],
      );
      assert.equal((await db.execute(`UPDATE ${table} SET done = ?`, [1])).changes, 2);
    });
  });

  test(`${target.name}: migrations apply once in order, resume, and stop at a failure with its file`, async () => {
    await withDatabase(target, async ({ connection, table, workspaceRoot }) => {
      const built = path.join(workspaceRoot, 'build', 'backend', 'migrations');
      const source = path.join(workspaceRoot, 'src', 'backend', 'migrations');
      await fs.mkdir(built, { recursive: true });
      await fs.mkdir(source, { recursive: true });
      const write = async (file, contents, sourceFile = file) => {
        await fs.writeFile(path.join(built, file), contents);
        await fs.writeFile(path.join(source, sourceFile), contents);
      };
      await write(
        '0001-create.sql',
        `CREATE TABLE ${table} (id INTEGER PRIMARY KEY, title TEXT);\n-- two statements; one file\nINSERT INTO ${table} (id, title) VALUES (1, 'first');\n`,
      );
      await write(
        '0002-seed.js',
        `export async function up(db) { await db.execute('INSERT INTO ${table} (id, title) VALUES (?, ?)', [2, 'second']); }\n`,
        '0002-seed.ts',
      );

      assert.deepEqual(await applyMigrations(connection, readAppMigrations(workspaceRoot)), [
        '0001-create',
        '0002-seed',
      ]);
      assert.deepEqual(await applyMigrations(connection, readAppMigrations(workspaceRoot)), []);

      await write('0003-more.sql', `INSERT INTO ${table} (id, title) VALUES (3, 'third');\n`);
      await write('0004-broken.sql', `INSERT INTO ${table} (id, nope) VALUES (4, 'x');\n`);
      await assert.rejects(
        applyMigrations(connection, readAppMigrations(workspaceRoot)),
        /migration src\/backend\/migrations\/0004-broken\.sql failed: .*nope/,
      );
      const status = await readMigrationStatus(connection, readAppMigrations(workspaceRoot));
      assert.deepEqual(
        status.map((entry) => [entry.id, entry.source, Boolean(entry.appliedAt)]),
        [
          ['0001-create', 'src/backend/migrations/0001-create.sql', true],
          ['0002-seed', 'src/backend/migrations/0002-seed.ts', true],
          ['0003-more', 'src/backend/migrations/0003-more.sql', true],
          ['0004-broken', 'src/backend/migrations/0004-broken.sql', false],
        ],
      );
      assert.deepEqual(
        (await connection.query(`SELECT id FROM ${table} ORDER BY id`)).map((row) => row.id),
        [1, 2, 3],
      );
      await connection.exec('DROP TABLE IF EXISTS webstir_migrations');
    });
  });
}

test('Postgres placeholders skip strings, identifiers and comments', () => {
  assert.equal(
    numberPlaceholders(`SELECT '?', "a?" FROM t -- ?\nWHERE a = ? /* ? */ AND b = ?`),
    `SELECT '?', "a?" FROM t -- ?\nWHERE a = $1 /* ? */ AND b = $2`,
  );
});

test('a migration that uses the app database, instead of its argument, runs in the opening', async () => {
  const { prepareApp } = await import('../dist/index.js');
  const { appDatabase, closeAppDatabase } = await import('../dist/db/index.js');
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-db-migration-'));
  const built = path.join(workspaceRoot, 'build', 'backend', 'migrations');
  await fs.mkdir(built, { recursive: true });
  const dbModule = new URL('../dist/db/index.js', import.meta.url).href;
  await fs.writeFile(
    path.join(built, '0001-seed.js'),
    `import { db } from ${JSON.stringify(dbModule)};\nexport async function up() {\n  await db.execute('CREATE TABLE seeded (name TEXT)');\n  await db.execute('INSERT INTO seeded (name) VALUES (?)', ['Ada']);\n}\n`,
  );
  prepareApp(workspaceRoot);
  try {
    const opened = await Promise.race([
      appDatabase(),
      Bun.sleep(3000).then(() => {
        throw new Error('the database never opened');
      }),
    ]);
    assert.deepEqual(await opened.get('SELECT name FROM seeded'), { name: 'Ada' });
  } finally {
    await closeAppDatabase();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('the batteries on ctx are shared: writing onto one fails instead of leaking into other requests', async () => {
  const { appServices } = await import('../dist/app/services.js');
  for (const [name, service] of Object.entries(appServices)) {
    assert.throws(
      () => {
        service.lastRequestId = 'r1';
      },
      TypeError,
      name,
    );
  }
});
