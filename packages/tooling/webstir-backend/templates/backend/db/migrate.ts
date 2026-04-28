#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createDatabaseClient } from './connection.js';
import type { DatabaseClient } from './connection.js';

const args = process.argv.slice(2);
const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const DEFAULT_MIGRATIONS_TABLE = '_webstir_migrations';

export type MigrationFn = (ctx: MigrationContext) => Promise<void> | void;

interface MigrationModule {
  id: string;
  up: MigrationFn;
  down?: MigrationFn;
}

export interface MigrationContext {
  sql(query: string, params?: unknown[]): Promise<void>;
  query<T = unknown>(query: string, params?: unknown[]): Promise<T[]>;
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const migrations = await loadMigrations();
  validateMigrationIds(migrations);

  if (args.includes('--list')) {
    printMigrations(migrations);
    return;
  }

  const direction: 'up' | 'down' = args.includes('--down') ? 'down' : 'up';
  const steps = parseSteps();

  const client = await createDatabaseClient();
  try {
    const table = getMigrationsTable();
    await ensureMigrationsTable(client, table);
    if (args.includes('--status')) {
      await printStatus(client, table, migrations);
    } else if (migrations.length === 0) {
      console.warn('[migrate] No migrations found under src/backend/db/migrations');
    } else if (direction === 'down') {
      await runDown(client, table, migrations, steps);
    } else {
      await runUp(client, table, migrations, steps);
    }
  } finally {
    await client.close();
  }
}

async function runUp(
  client: DatabaseClient,
  table: string,
  migrations: MigrationModule[],
  steps: number | undefined,
) {
  const applied = await getAppliedMigrations(client, table);
  const pending = migrations.filter((migration) => !applied.includes(migration.id));
  if (pending.length === 0) {
    console.info('[migrate] Database is up to date.');
    return;
  }

  const toRun = typeof steps === 'number' ? pending.slice(0, steps) : pending;
  for (const migration of toRun) {
    console.info(`[migrate] Applying ${migration.id}`);
    try {
      await runInTransaction(client, async () => {
        await migration.up(createMigrationContext(client));
        await recordMigration(client, table, migration.id);
      });
    } catch (error) {
      throw new Error(
        `[migrate] Migration ${migration.id} failed while applying. The migration was rolled back and was not recorded as applied.`,
        { cause: error },
      );
    }
  }
}

async function runDown(
  client: DatabaseClient,
  table: string,
  migrations: MigrationModule[],
  steps: number | undefined,
) {
  const applied = await getAppliedMigrations(client, table);
  if (applied.length === 0) {
    console.info('[migrate] No applied migrations to roll back.');
    return;
  }

  const toRollback = typeof steps === 'number' ? applied.slice(-steps) : applied;
  const migrationMap = new Map(migrations.map((migration) => [migration.id, migration]));

  for (const id of toRollback.reverse()) {
    const migration = migrationMap.get(id);
    if (!migration?.down) {
      console.warn(`[migrate] Skipping ${id} (no down() function exported).`);
      continue;
    }
    console.info(`[migrate] Reverting ${id}`);
    try {
      await runInTransaction(client, async () => {
        await migration.down?.(createMigrationContext(client));
        await deleteMigrationRecord(client, table, id);
      });
    } catch (error) {
      throw new Error(
        `[migrate] Migration ${id} failed while reverting. The migration record was kept so it can be retried.`,
        { cause: error },
      );
    }
  }
}

async function printStatus(client: DatabaseClient, table: string, migrations: MigrationModule[]) {
  const applied = await getAppliedMigrations(client, table);
  const knownIds = new Set(migrations.map((migration) => migration.id));
  const appliedIds = new Set(applied);
  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
  const missing = applied.filter((id) => !knownIds.has(id));

  console.info(`[migrate] Status for ${table}:`);
  console.info(`[migrate] Applied: ${applied.length}`);
  console.info(`[migrate] Pending: ${pending.length}`);
  if (pending.length > 0) {
    for (const migration of pending) {
      console.info(`- pending ${migration.id}`);
    }
  }
  if (missing.length > 0) {
    console.warn('[migrate] Applied records without local migration files:');
    for (const id of missing) {
      console.warn(`- missing ${id}`);
    }
  }
}

async function ensureMigrationsTable(client: DatabaseClient, table: string) {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ${table} (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
}

async function getAppliedMigrations(client: DatabaseClient, table: string): Promise<string[]> {
  const rows = await client.query<{ id: string }>(`SELECT id FROM ${table} ORDER BY applied_at`);
  return rows.map((row) => row.id);
}

async function recordMigration(client: DatabaseClient, table: string, id: string) {
  await client.execute(`INSERT INTO ${table} (id) VALUES (?)`, [id]);
}

async function deleteMigrationRecord(client: DatabaseClient, table: string, id: string) {
  await client.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

async function runInTransaction(client: DatabaseClient, action: () => Promise<void>) {
  await client.execute('BEGIN');
  try {
    await action();
    await client.execute('COMMIT');
  } catch (error) {
    try {
      await client.execute('ROLLBACK');
    } catch (rollbackError) {
      throw new Error('[migrate] Failed to roll back failed migration transaction.', {
        cause: rollbackError,
      });
    }
    throw error;
  }
}

function createMigrationContext(client: DatabaseClient): MigrationContext {
  return {
    sql: (query, params) => client.execute(query, params),
    query: (query, params) => client.query(query, params),
  };
}

async function loadMigrations(): Promise<MigrationModule[]> {
  try {
    const files = await fs.readdir(MIGRATIONS_DIR);
    const scriptFiles = files.filter((file) => /\.[cm]?[jt]s$/.test(file)).sort();
    const modules: MigrationModule[] = [];
    for (const file of scriptFiles) {
      const moduleUrl = `${pathToFileURL(path.join(MIGRATIONS_DIR, file)).href}?t=${Date.now()}`;
      const imported = (await import(moduleUrl)) as Record<string, unknown>;
      const migration = normalizeMigrationModule(imported, file);
      if (migration) {
        modules.push(migration);
      }
    }
    return modules;
  } catch (error) {
    console.error('[migrate] Failed to load migrations:', (error as Error).message);
    return [];
  }
}

function normalizeMigrationModule(
  exports: Record<string, unknown>,
  file: string,
): MigrationModule | undefined {
  const defaultExport =
    typeof exports.default === 'object' && exports.default !== null
      ? (exports.default as Record<string, unknown>)
      : undefined;
  const id =
    typeof exports.id === 'string'
      ? exports.id
      : typeof defaultExport?.id === 'string'
        ? defaultExport.id
        : path.basename(file).replace(/\.[cm]?[jt]s$/, '');
  const up: MigrationFn | undefined =
    typeof exports.up === 'function'
      ? (exports.up as MigrationFn)
      : typeof defaultExport?.up === 'function'
        ? (defaultExport.up as MigrationFn)
        : undefined;
  if (!up) {
    console.warn(`[migrate] ${file} does not export an up() function. Skipping.`);
    return undefined;
  }
  const down: MigrationFn | undefined =
    typeof exports.down === 'function'
      ? (exports.down as MigrationFn)
      : typeof defaultExport?.down === 'function'
        ? (defaultExport.down as MigrationFn)
        : undefined;
  return { id, up, down };
}

function validateMigrationIds(migrations: MigrationModule[]) {
  const seen = new Map<string, number>();
  const duplicates = new Set<string>();

  for (const migration of migrations) {
    const count = seen.get(migration.id) ?? 0;
    seen.set(migration.id, count + 1);
    if (count > 0) {
      duplicates.add(migration.id);
    }
  }

  if (duplicates.size > 0) {
    throw new Error(
      `[migrate] Duplicate migration id(s): ${Array.from(duplicates).sort().join(', ')}`,
    );
  }
}

function getMigrationsTable(): string {
  const table = process.env.DATABASE_MIGRATIONS_TABLE ?? DEFAULT_MIGRATIONS_TABLE;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(
      `[migrate] DATABASE_MIGRATIONS_TABLE must be a single SQL identifier using letters, numbers, and underscores, and must not start with a number (received "${table}").`,
    );
  }
  return table;
}

function parseSteps(): number | undefined {
  const value = parseOption('--steps');
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--steps must be a positive integer (received "${value}")`);
  }
  return Math.floor(parsed);
}

function parseOption(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('-')) {
    return args[index + 1];
  }
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  return undefined;
}

function printMigrations(migrations: MigrationModule[]) {
  if (migrations.length === 0) {
    console.info('[migrate] No migrations found.');
    return;
  }
  console.info('[migrate] Available migrations:');
  for (const migration of migrations) {
    console.info(`- ${migration.id}${migration.down ? '' : ' (no down)'}`);
  }
}

function printHelp() {
  console.info(`Usage:
  bun src/backend/db/migrate.ts [--list]
  bun src/backend/db/migrate.ts --status
  bun src/backend/db/migrate.ts --down [--steps 1]

Options:
  --list        Show local migrations and exit
  --status      Show applied, pending, and missing migration records
  --down        Roll back migrations instead of applying new ones
  --steps <n>   Limit how many migrations to run in the current direction
  --help        Show this message

Notes:
  - Defaults to reading migration files from src/backend/db/migrations.
  - DATABASE_MIGRATIONS_TABLE must be a single SQL identifier; it is validated before use.
  - Each migration runs in a transaction. Failed up() migrations are rolled back and not recorded.
  - For repeatable tests, use a throwaway DATABASE_URL and --down without --steps to run every available down() migration.
  - DATABASE_URL controls the target database (file:./dev.sqlite by default).
  - SQLite uses Bun's built-in bun:sqlite runtime; install 'pg' only for Postgres.`);
}

main().catch((error) => {
  console.error('[migrate] Failed:', error);
  process.exitCode = 1;
});
