import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import { resolveWorkspaceRoot } from '../env.js';

export interface DatabaseClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

type SqliteStatement = {
  all<T = unknown>(...params: unknown[]): T[];
  run(...params: unknown[]): unknown;
};

type SqliteDatabase = {
  prepare(sql: string): SqliteStatement;
  close(): void;
};

const require = createRequire(import.meta.url);

export async function createDatabaseClient(url = process.env.DATABASE_URL ?? 'file:./data/dev.sqlite'): Promise<DatabaseClient> {
  if (isSqlite(url)) {
    return createSqliteClient(url);
  }
  if (isPostgres(url)) {
    return createPostgresClient(url);
  }
  throw new Error(
    `[db] Unsupported DATABASE_URL '${url}'. Use file:./path/to.sqlite or postgres://...`
  );
}

function isSqlite(url: string): boolean {
  return url.startsWith('file:') || url.endsWith('.sqlite') || url.endsWith('.db');
}

function isPostgres(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

async function createSqliteClient(url: string): Promise<DatabaseClient> {
  const Database = loadBunSqlite();
  const target = normalizeSqlitePath(url);
  mkdirSync(path.dirname(target), { recursive: true });
  const db = new Database(target);

  return {
    async query(sql, params) {
      const statement = db.prepare(sql);
      return statement.all(...(params ?? []));
    },
    async execute(sql, params) {
      const statement = db.prepare(sql);
      statement.run(...(params ?? []));
    },
    async close() {
      db.close();
    }
  };
}

function loadBunSqlite(): new (filename: string) => SqliteDatabase {
  try {
    const sqliteModule = require('bun:sqlite');
    return sqliteModule.Database ?? sqliteModule.default ?? sqliteModule;
  } catch (error) {
    throw new Error(
      `[db] Failed to load bun:sqlite. Run the SQLite client with Bun or switch DATABASE_URL to postgres://... (${(error as Error).message})`
    );
  }
}

async function createPostgresClient(url: string): Promise<DatabaseClient> {
  type PgClientCtor = new (...args: any[]) => {
    query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
    connect: () => Promise<void>;
    end: () => Promise<void>;
  };

  let ClientCtor: PgClientCtor;
  try {
    const pgModule = await import('pg');
    ClientCtor = (pgModule as unknown as { Client: PgClientCtor }).Client;
  } catch (error) {
    throw new Error(
      `[db] Failed to load pg. Install it in your workspace with "bun add pg". (${(error as Error).message})`
    );
  }

  const client = new ClientCtor({ connectionString: url });
  await client.connect();

  return {
    async query(sql, params) {
      const result = await client.query(sql, params);
      return result.rows;
    },
    async execute(sql, params) {
      await client.query(sql, params);
    },
    async close() {
      await client.end();
    }
  };
}

function normalizeSqlitePath(url: string): string {
  const workspaceRoot = resolveWorkspaceRoot();
  const target = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return path.isAbsolute(target) ? path.resolve(target) : path.resolve(workspaceRoot, target);
}
