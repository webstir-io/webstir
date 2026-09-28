import type { DatabaseConnection } from './database.js';
import { applyMigrations, type Migration } from './migrations.js';

/** Webstir's own tables, by the battery that uses them; each is created the first time it is. */
export type WebstirTables = 'sessions' | 'jobs' | 'sign-in';

const TABLES: Record<WebstirTables, readonly { id: string; sql: string }[]> = {
  sessions: [
    {
      id: 'webstir/sessions-1',
      sql: `CREATE TABLE IF NOT EXISTS webstir_sessions (
  id TEXT PRIMARY KEY,
  record TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webstir_sessions_expires_at ON webstir_sessions (expires_at);`,
    },
  ],
  jobs: [
    {
      id: 'webstir/jobs-1',
      sql: `CREATE TABLE IF NOT EXISTS webstir_jobs (
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
CREATE INDEX IF NOT EXISTS webstir_jobs_due ON webstir_jobs (status, run_at);`,
    },
  ],
  'sign-in': [
    {
      id: 'webstir/sign-in-1',
      sql: `CREATE TABLE IF NOT EXISTS users (
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
  ON webstir_sign_in_challenges (email, created_at);`,
    },
  ],
};

const ensured = new WeakMap<DatabaseConnection, Map<WebstirTables, Promise<unknown>>>();

export function webstirMigrations(tables: WebstirTables): Migration[] {
  return TABLES[tables].map(({ id, sql }) => ({
    id,
    source: `Webstir's ${tables} tables`,
    apply: (connection) => connection.exec(sql),
  }));
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
