import path from 'node:path';
import { mkdirSync } from 'node:fs';

import { resolveWorkspaceRoot } from '../env.js';

export interface DatabaseClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  close(): Promise<void>;
}

type BunSqlClient = {
  unsafe<T = unknown>(query: string, params?: unknown[]): Promise<T[]>;
  close(options?: { timeout?: number }): Promise<void>;
};

type BunSqlConstructor = new (url?: string) => BunSqlClient;

type BunRuntime = {
  SQL?: BunSqlConstructor;
};

export async function createDatabaseClient(
  url = process.env.DATABASE_URL ?? 'file:./data/dev.sqlite',
): Promise<DatabaseClient> {
  const driver = detectDatabaseDriver(url);
  const SQL = loadBunSql();
  const normalizedUrl = driver === 'sqlite' ? normalizeSqliteUrl(url) : url;

  if (driver === 'sqlite') {
    ensureSqliteDirectory(normalizedUrl);
  }

  const client = new SQL(normalizedUrl);
  return createBunSqlClient(client, driver);
}

function detectDatabaseDriver(url: string): 'sqlite' | 'postgres' {
  const trimmed = url.trim();
  if (
    trimmed === ':memory:'
    || trimmed.startsWith('file:')
    || trimmed.startsWith('file://')
    || trimmed.startsWith('sqlite:')
    || trimmed.startsWith('sqlite://')
    || trimmed.endsWith('.sqlite')
    || trimmed.endsWith('.db')
  ) {
    return 'sqlite';
  }
  if (trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://')) {
    return 'postgres';
  }
  throw new Error(
    `[db] Unsupported DATABASE_URL '${url}'. Use file:./path/to.sqlite, sqlite:./path/to.sqlite, :memory:, or postgres://...`,
  );
}

function createBunSqlClient(
  client: BunSqlClient,
  driver: 'sqlite' | 'postgres',
): DatabaseClient {
  return {
    async query<T>(query, params) {
      const prepared = prepareQuery(query, params, driver);
      return await client.unsafe<T>(prepared.query, prepared.params);
    },
    async execute(query, params) {
      const prepared = prepareQuery(query, params, driver);
      await client.unsafe(prepared.query, prepared.params);
    },
    async close() {
      await client.close();
    },
  };
}

function prepareQuery(
  query: string,
  params: unknown[] | undefined,
  driver: 'sqlite' | 'postgres',
): {
  query: string;
  params: unknown[] | undefined;
} {
  if (!params || params.length === 0 || driver !== 'postgres' || !query.includes('?')) {
    return { query, params };
  }

  return {
    query: convertQuestionMarksToDollarParams(query),
    params,
  };
}

function loadBunSql(): BunSqlConstructor {
  const bunRuntime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  const SQL = bunRuntime?.SQL;
  if (SQL) {
    return SQL;
  }

  let reason = 'missing Bun.SQL runtime';
  try {
    reason = String(Bun.version);
  } catch (error) {
    reason = (error as Error).message;
  }

  throw new Error(`[db] Failed to load Bun.SQL. Run database helpers with Bun. (${reason})`);
}

function normalizeSqliteUrl(url: string): string {
  if (url.trim() === ':memory:') {
    return ':memory:';
  }

  const workspaceRoot = resolveWorkspaceRoot();
  const target = stripSqlitePrefix(url.trim());
  const resolved = path.isAbsolute(target) ? path.resolve(target) : path.resolve(workspaceRoot, target);
  return `file:${resolved}`;
}

function ensureSqliteDirectory(url: string): void {
  if (url === ':memory:') {
    return;
  }

  const filename = stripSqlitePrefix(url);
  mkdirSync(path.dirname(filename), { recursive: true });
}

function stripSqlitePrefix(url: string): string {
  if (url.startsWith('file://')) {
    return url.slice('file://'.length);
  }
  if (url.startsWith('file:')) {
    return url.slice('file:'.length);
  }
  if (url.startsWith('sqlite://')) {
    return url.slice('sqlite://'.length);
  }
  if (url.startsWith('sqlite:')) {
    return url.slice('sqlite:'.length);
  }
  return url;
}

function convertQuestionMarksToDollarParams(query: string): string {
  let result = '';
  let placeholderIndex = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < query.length; index += 1) {
    const character = query[index];
    const next = query[index + 1];

    if (inLineComment) {
      result += character;
      if (character === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      result += character;
      if (character === '*' && next === '/') {
        result += next;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && character === '-' && next === '-') {
      result += character + next;
      index += 1;
      inLineComment = true;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && character === '/' && next === '*') {
      result += character + next;
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === '\'' && !inDoubleQuote) {
      result += character;
      if (inSingleQuote && next === '\'') {
        result += next;
        index += 1;
      } else {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    if (character === '"' && !inSingleQuote) {
      result += character;
      if (inDoubleQuote && next === '"') {
        result += next;
        index += 1;
      } else {
        inDoubleQuote = !inDoubleQuote;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && character === '?') {
      placeholderIndex += 1;
      result += `$${placeholderIndex}`;
      continue;
    }

    result += character;
  }

  return result;
}
