import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Database as Sqlite } from 'bun:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import { closeAppDatabase, db, snapshotAppDatabase } from '../dist/db/index.js';

const KEYS = ['SNAPSHOT_URL', 'SNAPSHOT_KEEP', 'DATABASE_URL', 'SESSION_SECRET', 'STORAGE_URL'];

async function withApp(values, run) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, { SESSION_SECRET: 'snapshots-test-secret', ...values });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-snapshots-'));
  prepareApp(root);
  try {
    await run(root);
  } finally {
    await closeAppDatabase();
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function copies(root) {
  const folder = path.join(root, 'snapshots');
  const names = await fs.readdir(folder).catch(() => []);
  return names.filter((name) => name.endsWith('.sqlite')).sort();
}

function notesIn(file) {
  const copy = new Sqlite(file, { readonly: true });
  try {
    return copy
      .query('SELECT body FROM notes ORDER BY body')
      .all()
      .map((row) => row.body);
  } finally {
    copy.close();
  }
}

test('writes are followed by one copy of the database, and a copy waiting is taken before it closes', async () => {
  await withApp({ SNAPSHOT_URL: 'file:./snapshots' }, async (root) => {
    await db.execute('CREATE TABLE notes (body TEXT)');
    await db.execute("INSERT INTO notes (body) VALUES ('a')");
    await db.transaction(async (tx) => {
      await tx.execute("INSERT INTO notes (body) VALUES ('b')");
    });
    // Writes close together share one copy, taken once they settle.
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    const first = await copies(root);
    assert.equal(first.length, 1, first.join(', '));
    assert.deepEqual(notesIn(path.join(root, 'snapshots', first[0])), ['a', 'b']);

    // A read changes nothing, so nothing is copied.
    await db.query('SELECT * FROM notes');
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    assert.equal((await copies(root)).length, 1);

    // A write just before the database closes is still copied, however it was made.
    const writes = [
      ['execute', () => db.execute("INSERT INTO notes (body) VALUES ('c')")],
      ['get', () => db.get("INSERT INTO notes (body) VALUES ('d') RETURNING body")],
      ['query', () => db.query("UPDATE notes SET body = 'e' WHERE body = 'd' RETURNING body")],
    ];
    let expected = ['a', 'b'];
    for (const [how, write] of writes) {
      await write();
      await closeAppDatabase();
      const after = await copies(root);
      expected = (await db.query('SELECT body FROM notes ORDER BY body')).map((row) => row.body);
      assert.deepEqual(notesIn(path.join(root, 'snapshots', after.at(-1))), expected, how);
    }
    assert.deepEqual(expected, ['a', 'b', 'c', 'e']);
  });
});

test('SNAPSHOT_KEEP keeps only the newest copies', async () => {
  await withApp({ SNAPSHOT_URL: 'file:./snapshots', SNAPSHOT_KEEP: '2' }, async (root) => {
    await db.execute('CREATE TABLE notes (body TEXT)');
    const taken = [];
    for (const body of ['a', 'b', 'c']) {
      await db.execute('INSERT INTO notes (body) VALUES (?)', [body]);
      taken.push(await snapshotAppDatabase());
    }
    assert.deepEqual(await copies(root), taken.slice(1).sort());
  });
});

test('a snapshot needs SNAPSHOT_URL, and a SQLite database', async () => {
  await withApp({}, async () => {
    await assert.rejects(snapshotAppDatabase(), /SNAPSHOT_URL is not set/);
  });
  await withApp(
    { SNAPSHOT_URL: 'file:./snapshots', DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none' },
    async () => {
      await assert.rejects(snapshotAppDatabase(), /back up a Postgres database with its host/);
    },
  );
});

// A backup must not change what it backs up: taking one never applies a pending migration.
test('a snapshot copies the database as it is, applying no migration', async () => {
  await withApp(
    { SNAPSHOT_URL: 'file:./snapshots', DATABASE_URL: 'file:./app.sqlite' },
    async (root) => {
      const live = new Sqlite(path.join(root, 'app.sqlite'));
      live.run('CREATE TABLE notes (body TEXT)');
      live.run("INSERT INTO notes (body) VALUES ('kept')");
      live.close();
      const migrations = path.join(root, 'build', 'backend', 'migrations');
      await fs.mkdir(migrations, { recursive: true });
      await fs.writeFile(
        path.join(migrations, '0001_pending.sql'),
        'CREATE TABLE pending (id TEXT);\n',
      );

      const key = await snapshotAppDatabase();
      // Taken again, over a fresh connection each time, it is another copy.
      const again = await snapshotAppDatabase();
      assert.notEqual(again, key);
      await closeAppDatabase();

      const tables = (file) => {
        const copy = new Sqlite(file, { readonly: true });
        try {
          return copy
            .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .all()
            .map((row) => row.name);
        } finally {
          copy.close();
        }
      };
      assert.deepEqual(tables(path.join(root, 'snapshots', key)), ['notes']);
      assert.deepEqual(tables(path.join(root, 'app.sqlite')), ['notes']);
      assert.deepEqual(notesIn(path.join(root, 'snapshots', key)), ['kept']);
    },
  );
});

test('a snapshot of a database that is not there refuses, and makes none', async () => {
  await withApp(
    { SNAPSHOT_URL: 'file:./snapshots', DATABASE_URL: 'file:./missing.sqlite' },
    async (root) => {
      await assert.rejects(
        snapshotAppDatabase(),
        /There is no database at file:\.\/missing\.sqlite/,
      );
      assert.equal(
        await fs.access(path.join(root, 'missing.sqlite')).then(
          () => true,
          () => false,
        ),
        false,
      );
      assert.deepEqual(await copies(root), []);
    },
  );
});
