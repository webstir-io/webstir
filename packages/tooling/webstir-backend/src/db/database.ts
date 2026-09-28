import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { openPostgresDriver } from './postgres-driver.js';
import { openSqliteDriver } from './sqlite-driver.js';

export type DatabaseDialect = 'sqlite' | 'postgres';

export type DatabaseRow = Record<string, unknown>;

/** The app's database: SQL with `?` placeholders, on SQLite or Postgres. */
export interface Database {
  readonly dialect: DatabaseDialect;
  /** Every row the statement returns. */
  query<T = DatabaseRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** The first row, or undefined. */
  get<T = DatabaseRow>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  /** Runs a statement that returns no rows, and says how many rows it changed. */
  execute(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  /** Runs `work` in a transaction: it commits when `work` resolves and rolls back when it throws. */
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T>;
}

export interface DatabaseConnection extends Database {
  /** Runs a script of several statements without parameters, as a migration file holds. */
  exec(script: string): Promise<void>;
  /** Whether the code calling this runs inside one of this connection's transactions. */
  inTransaction(): boolean;
  close(): Promise<void>;
}

/** What each driver provides; the connection adds placeholders, values and transactions. */
export interface DatabaseDriver {
  readonly dialect: DatabaseDialect;
  query(sql: string, params: readonly unknown[]): Promise<DatabaseRow[]>;
  execute(sql: string, params: readonly unknown[]): Promise<number>;
  exec(script: string): Promise<void>;
  close(): Promise<void>;
  /**
   * A driver with a pool runs work outside a transaction side by side, and gives each transaction
   * a connection of its own. Without one, the driver has a single connection, which a
   * transaction holds while other work waits.
   */
  begin?<T>(work: (connection: DatabaseDriver) => Promise<T>): Promise<T>;
}

export interface DatabaseTarget {
  readonly dialect: DatabaseDialect;
  /** The SQLite file (or `:memory:`), or the Postgres URL. */
  readonly location: string;
}

export const DEFAULT_DATABASE_URL = 'file:./data/app.sqlite';

/** Where a DATABASE_URL points: a SQLite file relative to the workspace, or a Postgres server. */
export function resolveDatabaseTarget(url: string, workspaceRoot: string): DatabaseTarget {
  const trimmed = url.trim();
  if (trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://')) {
    return { dialect: 'postgres', location: trimmed };
  }
  if (trimmed === ':memory:' || trimmed === 'sqlite::memory:') {
    return { dialect: 'sqlite', location: ':memory:' };
  }
  const file = trimmed.replace(/^(?:sqlite|file):(?:\/\/)?/, '');
  if (!file || file === trimmed) {
    throw new Error(
      `DATABASE_URL "${url}" is not a database URL; use file:./data/app.sqlite or postgres://user:password@host/database.`,
    );
  }
  return { dialect: 'sqlite', location: path.resolve(workspaceRoot, file) };
}

export async function openDatabase(
  url: string,
  options: { readonly workspaceRoot: string },
): Promise<DatabaseConnection> {
  const target = resolveDatabaseTarget(url, options.workspaceRoot);
  if (target.dialect === 'sqlite' && target.location !== ':memory:') {
    mkdirSync(path.dirname(target.location), { recursive: true });
  }
  const driver =
    target.dialect === 'sqlite'
      ? openSqliteDriver(target.location)
      : await openPostgresDriver(target.location);
  return createConnection(driver);
}

interface TransactionScope {
  readonly driver: DatabaseDriver;
  readonly depth: number;
}

/**
 * A connection over a driver. Work inside a transaction, through `tx` or not, runs in it: the
 * transaction is found from where the work started, not passed along.
 */
export function createConnection(driver: DatabaseDriver): DatabaseConnection {
  const scope = new AsyncLocalStorage<TransactionScope>();
  let queue: Promise<unknown> = Promise.resolve();
  // A single connection runs one thing at a time, so a transaction is never interleaved with
  // other work; a pool needs no queue.
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    if (driver.begin || scope.getStore()) return work();
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };
  const current = () => scope.getStore()?.driver ?? driver;

  const database: Database = {
    dialect: driver.dialect,
    async query<T>(sql: string, params: readonly unknown[] = []) {
      return (await serial(() =>
        current().query(toDialect(sql, driver.dialect, params), toValues(params)),
      )) as T[];
    },
    async get<T>(sql: string, params: readonly unknown[] = []) {
      const rows = await database.query<T>(sql, params);
      return rows[0];
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      const changes = await serial(() =>
        current().execute(toDialect(sql, driver.dialect, params), toValues(params)),
      );
      return { changes };
    },
    transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
      const outer = scope.getStore();
      if (outer) {
        const level = outer.depth + 1;
        const savepoint = `webstir_${level}`;
        return (async () => {
          await outer.driver.exec(`SAVEPOINT ${savepoint}`);
          try {
            const result = await scope.run({ driver: outer.driver, depth: level }, () =>
              work(database),
            );
            await outer.driver.exec(`RELEASE SAVEPOINT ${savepoint}`);
            return result;
          } catch (error) {
            await outer.driver.exec(
              `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`,
            );
            throw error;
          }
        })();
      }
      if (driver.begin) {
        return driver.begin((connection) =>
          scope.run({ driver: connection, depth: 1 }, () => work(database)),
        );
      }
      return serial(async () => {
        await driver.exec('BEGIN');
        try {
          const result = await scope.run({ driver, depth: 1 }, () => work(database));
          await driver.exec('COMMIT');
          return result;
        } catch (error) {
          await driver.exec('ROLLBACK');
          throw error;
        }
      });
    },
  };

  return {
    ...database,
    inTransaction: () => Boolean(scope.getStore()),
    exec: (script) => serial(() => current().exec(script)),
    close: () => serial(() => driver.close()),
  };
}

/** Dates are stored as ISO strings and booleans as 1 and 0, the same on both databases. */
function toValues(params: readonly unknown[]): unknown[] {
  return params.map((value) => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === undefined) return null;
    return value;
  });
}

function toDialect(sql: string, dialect: DatabaseDialect, params: readonly unknown[]): string {
  return dialect === 'postgres' && params.length > 0 ? numberPlaceholders(sql) : sql;
}

/** Postgres numbers its placeholders; `?` outside strings, identifiers and comments becomes `$n`. */
export function numberPlaceholders(sql: string): string {
  let result = '';
  let index = 0;
  let quote: string | undefined;
  let comment: 'line' | 'block' | undefined;
  for (let at = 0; at < sql.length; at += 1) {
    const character = sql[at];
    const next = sql[at + 1];
    if (comment === 'line') {
      if (character === '\n') comment = undefined;
    } else if (comment === 'block') {
      if (character === '*' && next === '/') {
        result += '*/';
        at += 1;
        comment = undefined;
        continue;
      }
    } else if (quote) {
      if (character === quote) {
        if (next === quote) {
          result += character + next;
          at += 1;
          continue;
        }
        quote = undefined;
      }
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '-' && next === '-') {
      comment = 'line';
    } else if (character === '/' && next === '*') {
      comment = 'block';
    } else if (character === '?') {
      index += 1;
      result += `$${index}`;
      continue;
    }
    result += character;
  }
  return result;
}
