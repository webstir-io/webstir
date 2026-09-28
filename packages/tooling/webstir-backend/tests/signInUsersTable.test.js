import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import { appDatabase, closeAppDatabase } from '../dist/db/index.js';
import { declareSignInTables, signInDatabase } from '../dist/sign-in/database.js';

// An app that brings its own users table: made by one migration, given session_version by a later one.
const MIGRATIONS = {
  '0001-users.sql': `CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);`,
  '0002-session-version.sql': 'ALTER TABLE users ADD session_version INTEGER NOT NULL DEFAULT 0;',
};

async function openWith(options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-users-table-'));
  const built = path.join(root, 'build', 'backend', 'migrations');
  await fs.mkdir(built, { recursive: true });
  for (const [file, sql] of Object.entries(MIGRATIONS))
    await fs.writeFile(path.join(built, file), sql);
  process.env.DATABASE_URL = `file:${path.join(root, 'app.sqlite')}`;
  prepareApp(root);
  declareSignInTables(options);
  return root;
}

test("an app whose migrations make the users table keeps its own, and sign-in's tables follow", async () => {
  const root = await openWith({ usersTable: 'app' });
  try {
    const db = await signInDatabase();
    const columns = (await db.query('SELECT name FROM pragma_table_info(?)', ['users'])).map(
      (row) => row.name,
    );
    assert.deepEqual(columns, ['id', 'email', 'status', 'created_at', 'session_version']);
    assert.deepEqual(await db.query('SELECT COUNT(*) AS count FROM webstir_sign_in_challenges'), [
      { count: 0 },
    ]);
  } finally {
    await closeAppDatabase();
    delete process.env.DATABASE_URL;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("by default Webstir's users table comes first, so the app's migrations can reference it", async () => {
  const root = await openWith({});
  try {
    await assert.rejects(appDatabase(), /0001-users\.sql failed: table users already exists/);
  } finally {
    await closeAppDatabase();
    delete process.env.DATABASE_URL;
    await fs.rm(root, { recursive: true, force: true });
  }
});
