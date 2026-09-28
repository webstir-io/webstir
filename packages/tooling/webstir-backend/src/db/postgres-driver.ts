import { SQL } from 'bun';

import type { DatabaseDriver, DatabaseRow } from './database.js';

interface SqlClient {
  unsafe(sql: string, params?: unknown[]): Promise<unknown> & { simple(): Promise<unknown> };
}

/**
 * Postgres through Bun.SQL's pool: work outside a transaction runs side by side, and each
 * transaction has a connection of its own. Statements are not prepared by name, so a connection
 * pooler in front of Postgres (PgBouncer, a hosted pooler) works too.
 */
export async function openPostgresDriver(url: string): Promise<DatabaseDriver> {
  const pool = new SQL({ url, prepare: false });
  // Fail now, with the database's own error, rather than on the first request.
  await pool.unsafe('SELECT 1');
  const over = (client: SqlClient): DatabaseDriver => ({
    dialect: 'postgres',
    async query(sql, params) {
      return [...((await client.unsafe(sql, params as unknown[])) as DatabaseRow[])];
    },
    async execute(sql, params) {
      const result = (await client.unsafe(sql, params as unknown[])) as { count?: number };
      return Number(result.count ?? 0);
    },
    async exec(script) {
      await client.unsafe(script).simple();
    },
    async close() {
      await pool.close();
    },
  });
  return {
    ...over(pool as unknown as SqlClient),
    begin: (work) => pool.begin((tx) => work(over(tx as unknown as SqlClient))),
  };
}
