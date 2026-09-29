import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareApp } from '../dist/index.js';
import { closeAppDatabase, migrateAppDatabase, openDatabase } from '../dist/db/index.js';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

test('a migration run by webstir migrate uses the database being migrated, as at server start', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-migrate-'));
  const built = path.join(root, 'build', 'backend');
  await fs.mkdir(path.join(built, 'migrations'), { recursive: true });
  await fs.mkdir(path.join(built, 'jobs', 'note'), { recursive: true });
  await fs.writeFile(
    path.join(built, 'jobs', 'note', 'index.js'),
    'export async function run() {}\n',
  );
  await fs.writeFile(
    path.join(built, 'migrations', '0001-notes.sql'),
    'CREATE TABLE notes (id TEXT);',
  );
  // Written as an app's compiled migration: through Webstir's db and jobs, not its argument.
  await fs.writeFile(
    path.join(built, 'migrations', '0002-queue.js'),
    `import { db } from ${JSON.stringify(path.join(dist, 'db', 'index.js'))};
import { jobs } from ${JSON.stringify(path.join(dist, 'jobs', 'index.js'))};
export async function up() {
  await db.execute("INSERT INTO notes (id) VALUES ('first')");
  await jobs.enqueue('note', { id: 'first' });
}
`,
  );
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path.join(root, 'app.sqlite')}`;
  prepareApp(root);
  try {
    assert.deepEqual(await migrateAppDatabase(), ['0001-notes', '0002-queue']);
    const check = await openDatabase(process.env.DATABASE_URL, { workspaceRoot: root });
    try {
      assert.deepEqual(await check.query('SELECT id FROM notes'), [{ id: 'first' }]);
      assert.deepEqual(await check.query('SELECT name, payload FROM webstir_jobs'), [
        { name: 'note', payload: JSON.stringify({ id: 'first' }) },
      ]);
    } finally {
      await check.close();
    }
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 20_000);
