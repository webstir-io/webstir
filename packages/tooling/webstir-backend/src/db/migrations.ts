import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Database, DatabaseConnection } from './database.js';

/** One step in the database's history, applied once and recorded. */
export interface Migration {
  readonly id: string;
  /** Where it comes from, for messages: the app's source file, or Webstir's table. */
  readonly source: string;
  apply(connection: DatabaseConnection): Promise<void>;
}

export interface MigrationStatus {
  readonly id: string;
  readonly source: string;
  readonly appliedAt?: string;
}

export class MigrationError extends Error {
  constructor(
    readonly source: string,
    cause: unknown,
  ) {
    super(`migration ${source} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'MigrationError';
  }
}

const TABLE = 'webstir_migrations';
const MIGRATION_FILE = /^(.+)\.(sql|js|mjs)$/;

/**
 * The app's migrations, from the built backend: `.sql` files as written, and `.ts` or `.js` files
 * compiled, each exporting `up(db)`. They apply in file name order.
 */
export function readAppMigrations(workspaceRoot: string): Migration[] {
  const builtRoot = path.join(workspaceRoot, 'build', 'backend', 'migrations');
  if (!existsSync(builtRoot)) return [];
  const sourceRoot = path.join(workspaceRoot, 'src', 'backend', 'migrations');
  const migrations: Migration[] = [];
  const seen = new Map<string, string>();
  for (const file of readdirSync(builtRoot).sort()) {
    const match = MIGRATION_FILE.exec(file);
    if (!match) continue;
    const id = match[1] as string;
    const source = sourceLabel(sourceRoot, id, match[2] as string);
    const other = seen.get(id);
    if (other) {
      throw new Error(`${other} and ${source} are both migration "${id}"; rename one.`);
    }
    seen.set(id, source);
    const file_ = path.join(builtRoot, file);
    migrations.push({
      id,
      source,
      async apply(connection) {
        if (file.endsWith('.sql')) {
          await connection.exec(readFileSync(file_, 'utf8'));
          return;
        }
        const module = (await import(pathToFileURL(file_).href)) as {
          up?: (db: Database) => Promise<void> | void;
          default?: (db: Database) => Promise<void> | void;
        };
        const up = module.up ?? module.default;
        if (typeof up !== 'function') {
          throw new Error('it exports no up(db) function');
        }
        await up(connection);
      },
    });
  }
  return migrations;
}

/** Applies the migrations not yet recorded, each with its record in one transaction. */
export async function applyMigrations(
  connection: DatabaseConnection,
  migrations: readonly Migration[],
): Promise<string[]> {
  if (migrations.length === 0) return [];
  const applied = await readApplied(connection);
  const done: string[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    try {
      await connection.transaction(async (tx) => {
        await migration.apply(connection);
        await tx.execute(`INSERT INTO ${TABLE} (id, applied_at) VALUES (?, ?)`, [
          migration.id,
          new Date().toISOString(),
        ]);
      });
    } catch (error) {
      throw new MigrationError(migration.source, error);
    }
    done.push(migration.id);
  }
  return done;
}

export async function readMigrationStatus(
  connection: DatabaseConnection,
  migrations: readonly Migration[],
): Promise<MigrationStatus[]> {
  const applied = await readApplied(connection);
  return migrations.map((migration) => ({
    id: migration.id,
    source: migration.source,
    ...(applied.has(migration.id) ? { appliedAt: applied.get(migration.id) } : {}),
  }));
}

async function readApplied(connection: DatabaseConnection): Promise<Map<string, string>> {
  await connection.exec(
    `CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
  );
  const rows = await connection.query<{ id: string; applied_at: string }>(
    `SELECT id, applied_at FROM ${TABLE}`,
  );
  return new Map(rows.map((row) => [row.id, row.applied_at]));
}

function sourceLabel(sourceRoot: string, id: string, builtExtension: string): string {
  const extensions = builtExtension === 'sql' ? ['sql'] : ['ts', 'mts', 'js', 'mjs'];
  const found = extensions.find((extension) =>
    existsSync(path.join(sourceRoot, `${id}.${extension}`)),
  );
  return `src/backend/migrations/${id}.${found ?? builtExtension}`;
}
