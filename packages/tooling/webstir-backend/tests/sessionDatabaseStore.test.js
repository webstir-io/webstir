import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { createDatabaseSessionStore } from '../dist/runtime/session-database-store.js';
import { databaseTargets, openEmptyDatabase } from './support/databases.js';

const record = (id) => ({
  id,
  value: { userId: 'ada' },
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2999-01-01T00:00:00.000Z',
});

async function tableNames(db) {
  const rows = await db.query(
    db.dialect === 'sqlite'
      ? "SELECT name FROM sqlite_master WHERE type = 'table'"
      : 'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()',
  );
  return rows.map((row) => row.name);
}

const starts = [
  {
    name: 'a new database',
    async prepare() {},
    async check() {},
  },
  {
    name: "an app's own webstir_sessions, from the old session template",
    async prepare(db) {
      await db.exec(`CREATE TABLE webstir_sessions (
  id TEXT PRIMARY KEY, value TEXT NOT NULL, flash TEXT NOT NULL, runtime TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
)`);
      await db.execute(
        'INSERT INTO webstir_sessions (id, value, flash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        ['old', '{}', '[]', '2026-01-01', '2999-01-01'],
      );
    },
    async check(db) {
      assert.deepEqual(await db.query('SELECT id, value FROM webstir_sessions'), [
        { id: 'old', value: '{}' },
      ]);
    },
  },
  {
    name: "Webstir 0.7.0's webstir_sessions, whose sessions carry over",
    async prepare(db) {
      await db.exec(`CREATE TABLE webstir_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE webstir_sessions (id TEXT PRIMARY KEY, record TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE INDEX webstir_sessions_expires_at ON webstir_sessions (expires_at);`);
      await db.execute('INSERT INTO webstir_migrations (id, applied_at) VALUES (?, ?)', [
        'webstir/sessions-1',
        '2026-09-01T00:00:00.000Z',
      ]);
      await db.execute('INSERT INTO webstir_sessions (id, record, expires_at) VALUES (?, ?, ?)', [
        'kept',
        JSON.stringify(record('kept')),
        '2999-01-01T00:00:00.000Z',
      ]);
    },
    async check(db, store) {
      assert.deepEqual(await store.get('kept'), record('kept'));
      assert.ok(!(await tableNames(db)).includes('webstir_sessions'));
    },
  },
];

for (const target of databaseTargets) {
  for (const start of starts) {
    test(`${target.name}: database sessions work on ${start.name}`, async () => {
      const db = await openEmptyDatabase(target);
      try {
        await start.prepare(db);
        const store = createDatabaseSessionStore(async () => db);

        await store.set(record('new'));
        assert.deepEqual(await store.get('new'), record('new'));
        await store.set({ ...record('new'), value: { userId: 'grace' } });
        assert.deepEqual((await store.get('new'))?.value, { userId: 'grace' });
        await store.delete('new');
        assert.equal(await store.get('new'), undefined);

        assert.ok((await tableNames(db)).includes('webstir_session_records'));
        await start.check(db, store);
      } finally {
        await db.close();
      }
    });
  }
}
