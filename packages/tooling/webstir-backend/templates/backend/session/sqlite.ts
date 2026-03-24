import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type {
  SessionFlashMessage,
  SessionStore,
  SessionStoreRecord,
} from '@webstir-io/webstir-backend/runtime/session';

import { resolveWorkspaceRoot } from '../env.js';

interface SqliteSessionStoreOptions {
  url?: string;
}

interface SqliteSessionRow {
  id: string;
  value: string;
  flash: string;
  runtime: string;
  createdAt: string;
  expiresAt: string;
}

type SqliteDatabase = {
  prepare(sql: string): {
    run(...params: unknown[]): void;
    get(...params: unknown[]): SqliteSessionRow | undefined;
    all(...params: unknown[]): { name: string }[];
  };
};

const DEFAULT_SQLITE_SESSION_STORE_URL = 'file:./data/sessions.sqlite';
const SESSION_TABLE_NAME = 'webstir_sessions';
const require = createRequire(import.meta.url);

export function createSqliteSessionStore<
  TSession extends Record<string, unknown> = Record<string, unknown>,
>(options: SqliteSessionStoreOptions = {}): SessionStore<TSession> {
  const Database = loadBunSqlite();
  const target = normalizeSqlitePath(options.url ?? DEFAULT_SQLITE_SESSION_STORE_URL);
  mkdirSync(path.dirname(target), { recursive: true });

  const db = new Database(target) as SqliteDatabase;
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ${SESSION_TABLE_NAME} (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      flash TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `).run();
  ensureRuntimeColumn(db);
  db.prepare(`
    CREATE INDEX IF NOT EXISTS ${SESSION_TABLE_NAME}_expires_at_idx
    ON ${SESSION_TABLE_NAME} (expires_at)
  `).run();

  const deleteExpiredStatement = db.prepare(
    `DELETE FROM ${SESSION_TABLE_NAME} WHERE expires_at <= ?`,
  );
  const getStatement = db.prepare(`
    SELECT id, value, flash, runtime, created_at AS createdAt, expires_at AS expiresAt
    FROM ${SESSION_TABLE_NAME}
    WHERE id = ?
  `);
  const setStatement = db.prepare(`
    INSERT INTO ${SESSION_TABLE_NAME} (id, value, flash, runtime, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      value = excluded.value,
      flash = excluded.flash,
      runtime = excluded.runtime,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `);
  const deleteStatement = db.prepare(`DELETE FROM ${SESSION_TABLE_NAME} WHERE id = ?`);

  return {
    get(sessionId) {
      deleteExpiredStatement.run(new Date().toISOString());
      const row = getStatement.get(sessionId);
      return row ? deserializeSessionRecord<TSession>(row) : undefined;
    },
    set(record) {
      setStatement.run(
        record.id,
        JSON.stringify(record.value),
        JSON.stringify(record.flash),
        JSON.stringify(record.runtime ?? {}),
        record.createdAt,
        record.expiresAt,
      );
    },
    delete(sessionId) {
      deleteStatement.run(sessionId);
    },
  };
}

function ensureRuntimeColumn(db: SqliteDatabase): void {
  const columns = db.prepare(`PRAGMA table_info(${SESSION_TABLE_NAME})`).all();
  if (columns.some((column) => column.name === 'runtime')) {
    return;
  }

  db.prepare(
    `ALTER TABLE ${SESSION_TABLE_NAME} ADD COLUMN runtime TEXT NOT NULL DEFAULT '{}'`,
  ).run();
}

function loadBunSqlite(): new (filename: string) => SqliteDatabase {
  try {
    const sqliteModule = require('bun:sqlite');
    return sqliteModule.Database ?? sqliteModule.default ?? sqliteModule;
  } catch (error) {
    throw new Error(
      `[session] Failed to load bun:sqlite. Run the SQLite session store with Bun or switch SESSION_STORE_DRIVER to "memory". (${(error as Error).message})`,
    );
  }
}

function normalizeSqlitePath(url: string): string {
  const workspaceRoot = resolveWorkspaceRoot();
  const target = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return path.isAbsolute(target) ? path.resolve(target) : path.resolve(workspaceRoot, target);
}

function deserializeSessionRecord<TSession extends Record<string, unknown>>(
  row: SqliteSessionRow,
): SessionStoreRecord<TSession> {
  return {
    id: row.id,
    value: JSON.parse(row.value) as TSession,
    flash: JSON.parse(row.flash) as SessionFlashMessage[],
    runtime: JSON.parse(row.runtime),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}
