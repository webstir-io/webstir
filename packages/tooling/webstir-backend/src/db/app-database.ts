import { existsSync } from 'node:fs';

import { appRoot } from '../app/app-root.js';
import {
  DEFAULT_DATABASE_URL,
  openDatabase,
  resolveDatabaseTarget,
  type Database,
  type DatabaseConnection,
} from './database.js';
import { ensureWebstirTables, type WebstirTables } from './webstir-tables.js';
import {
  applyMigrations,
  readAppMigrations,
  readMigrationStatus,
  type MigrationStatus,
} from './migrations.js';

let opening: Promise<DatabaseConnection> | undefined;
let opened: DatabaseConnection | undefined;
const whenOpen = new Set<(connection: DatabaseConnection) => void>();
const firstTables = new Set<WebstirTables>();

/**
 * Webstir tables the app's migrations may build on, created before them when the database opens:
 * with sign-in, a migration can reference `users (id)`.
 */
export function declareWebstirTables(tables: WebstirTables): void {
  firstTables.add(tables);
}

export function appDatabaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL;
}

/**
 * The app's database, opened the first time something uses it, with the app's migrations applied.
 * An app that never touches it never creates one.
 */
export function appDatabase(): Promise<DatabaseConnection> {
  if (!opening) {
    opening = (async () => {
      const workspaceRoot = appRoot();
      const connection = await openDatabase(appDatabaseUrl(), { workspaceRoot });
      try {
        await applyFirstTables(connection);
        await applyMigrations(connection, readAppMigrations(workspaceRoot));
      } catch (error) {
        await connection.close();
        throw error;
      }
      opened = connection;
      for (const listener of whenOpen) listener(connection);
      return connection;
    })();
    opening.catch(() => {
      opening = undefined;
    });
  }
  return opening;
}

/** Whether the app has a database already: a Postgres URL, or a SQLite file that exists. */
export function appDatabaseExists(): boolean {
  const target = resolveDatabaseTarget(appDatabaseUrl(), appRoot());
  if (target.dialect === 'postgres') return true;
  return target.location !== ':memory:' && existsSync(target.location);
}

/** Runs `listener` once the database is open, now if it already is. */
export function onAppDatabaseOpen(listener: (connection: DatabaseConnection) => void): () => void {
  whenOpen.add(listener);
  if (opened) listener(opened);
  return () => whenOpen.delete(listener);
}

export async function closeAppDatabase(): Promise<void> {
  const current = opening;
  opening = undefined;
  opened = undefined;
  whenOpen.clear();
  if (current) await (await current.catch(() => undefined))?.close();
}

/** The app's database, for handlers, jobs and scripts: it opens on first use. */
export const db: Database = {
  get dialect() {
    return resolveDatabaseTarget(appDatabaseUrl(), appRoot()).dialect;
  },
  async query<T>(sql: string, params?: readonly unknown[]) {
    return (await appDatabase()).query<T>(sql, params);
  },
  async get<T>(sql: string, params?: readonly unknown[]) {
    return (await appDatabase()).get<T>(sql, params);
  },
  async execute(sql: string, params?: readonly unknown[]) {
    return (await appDatabase()).execute(sql, params);
  },
  async transaction<T>(work: (tx: Database) => Promise<T>) {
    return (await appDatabase()).transaction(work);
  },
};

/** Applies the app's pending migrations, as the server does when it starts, and says which. */
export async function migrateAppDatabase(): Promise<string[]> {
  const connection = await openDatabase(appDatabaseUrl(), { workspaceRoot: appRoot() });
  try {
    await applyFirstTables(connection);
    return await applyMigrations(connection, readAppMigrations(appRoot()));
  } finally {
    await connection.close();
  }
}

/** Each of the app's migrations, and when it was applied, if it was. */
export async function appMigrationStatus(): Promise<MigrationStatus[]> {
  const migrations = readAppMigrations(appRoot());
  if (!appDatabaseExists()) return migrations.map(({ id, source }) => ({ id, source }));
  const connection = await openDatabase(appDatabaseUrl(), { workspaceRoot: appRoot() });
  try {
    return await readMigrationStatus(connection, migrations);
  } finally {
    await connection.close();
  }
}

async function applyFirstTables(connection: DatabaseConnection): Promise<void> {
  for (const tables of firstTables) await ensureWebstirTables(connection, tables);
}
