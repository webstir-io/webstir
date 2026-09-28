import type { DatabaseConnection } from './database.js';
import { applyMigrations, type Migration } from './migrations.js';

/** Webstir's own tables, by the battery that uses them; each is created the first time it is. */
export type WebstirTables = 'sessions' | 'jobs' | 'sign-in';

type Step = { readonly id: string; apply(connection: DatabaseConnection): Promise<void> };

const script =
  (sql: string) =>
  (connection: DatabaseConnection): Promise<void> =>
    connection.exec(sql);

const TABLES: Record<WebstirTables, readonly Step[]> = {
  sessions: [{ id: 'webstir/sessions-2', apply: createSessionRecords }],
  jobs: [
    {
      id: 'webstir/jobs-1',
      apply: script(`CREATE TABLE IF NOT EXISTS webstir_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL,
  run_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webstir_jobs_due ON webstir_jobs (status, run_at);`),
    },
  ],
  'sign-in': [
    {
      id: 'webstir/sign-in-1',
      apply: script(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webstir_sign_in_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts_remaining INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS webstir_sign_in_challenges_email
  ON webstir_sign_in_challenges (email, created_at);`),
    },
  ],
};

const ensured = new WeakMap<DatabaseConnection, Map<WebstirTables, Promise<unknown>>>();

export function webstirMigrations(tables: WebstirTables): Migration[] {
  return TABLES[tables].map(({ id, apply }) => ({
    id,
    source: `Webstir's ${tables} tables`,
    apply,
  }));
}

/**
 * Sessions live in `webstir_session_records`. Webstir 0.7.0 kept them in `webstir_sessions`: they
 * are copied across, and that table is left for a 0.7.0 server still running on the database. A
 * `webstir_sessions` of another shape is an app's own, from the old session template.
 */
async function createSessionRecords(connection: DatabaseConnection): Promise<void> {
  const [sessions, records] = await Promise.all([
    tableColumns(connection, 'webstir_sessions'),
    tableColumns(connection, 'webstir_session_records'),
  ]);
  await connection.exec(`CREATE TABLE IF NOT EXISTS webstir_session_records (
  id TEXT PRIMARY KEY,
  record TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webstir_session_records_expires_at ON webstir_session_records (expires_at);`);
  if (records.length === 0 && sessions.sort().join() === 'expires_at,id,record') {
    await connection.exec(`INSERT INTO webstir_session_records (id, record, expires_at)
SELECT id, record, expires_at FROM webstir_sessions`);
  }
}

async function tableColumns(connection: DatabaseConnection, table: string): Promise<string[]> {
  const rows = await connection.query<{ name: string }>(
    connection.dialect === 'sqlite'
      ? 'SELECT name FROM pragma_table_info(?)'
      : `SELECT column_name AS name FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = ?`,
    [table],
  );
  return rows.map((row) => row.name);
}

/** Creates a battery's tables once per connection, before its first query outside a transaction. */
export function ensureWebstirTables(
  connection: DatabaseConnection,
  tables: WebstirTables,
): Promise<unknown> {
  let byTables = ensured.get(connection);
  if (!byTables) {
    byTables = new Map();
    ensured.set(connection, byTables);
  }
  let pending = byTables.get(tables);
  // Inside a caller's transaction the tables would go if it rolled back, so that is not kept.
  if (!pending && connection.inTransaction()) {
    return applyMigrations(connection, webstirMigrations(tables));
  }
  if (!pending) {
    pending = applyMigrations(connection, webstirMigrations(tables));
    pending.catch(() => byTables?.delete(tables));
    byTables.set(tables, pending);
  }
  return pending;
}
