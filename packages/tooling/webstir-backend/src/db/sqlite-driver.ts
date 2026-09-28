import { Database as SqliteDatabase, type SQLQueryBindings } from 'bun:sqlite';

import type { DatabaseDriver, DatabaseRow } from './database.js';

/** SQLite through bun:sqlite, set up for an app: WAL, foreign keys, and waiting on a busy file. */
export function openSqliteDriver(filename: string): DatabaseDriver {
  const sqlite = new SqliteDatabase(filename, { create: true });
  if (filename !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec('PRAGMA busy_timeout = 5000');

  return {
    dialect: 'sqlite',
    async query(sql, params) {
      return sqlite.query(sql).all(...(params as SQLQueryBindings[])) as DatabaseRow[];
    },
    async execute(sql, params) {
      return sqlite.query(sql).run(...(params as SQLQueryBindings[])).changes;
    },
    async exec(script) {
      sqlite.exec(script);
    },
    async close() {
      sqlite.close();
    },
  };
}
