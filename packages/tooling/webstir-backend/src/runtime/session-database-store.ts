import type { DatabaseConnection } from '../db/database.js';
import { ensureWebstirTables, sessionsTable } from '../db/webstir-tables.js';
import type { SessionStore, SessionStoreRecord } from './session.js';

const PURGE_EVERY_MS = 60 * 60 * 1000;

/**
 * Sessions kept in the app's database, so they survive restarts and deploys. The database opens
 * the first time a session is stored or read, so an app without sessions never creates one.
 */
export function createDatabaseSessionStore<
  TSession extends Record<string, unknown> = Record<string, unknown>,
>(connect: () => Promise<DatabaseConnection>): SessionStore<TSession> {
  let lastPurge = 0;
  const tables = new WeakMap<DatabaseConnection, Promise<string>>();
  const database = async () => {
    const connection = await connect();
    await ensureWebstirTables(connection, 'sessions');
    let table = tables.get(connection);
    if (!table) {
      table = sessionsTable(connection);
      table.catch(() => tables.delete(connection));
      tables.set(connection, table);
    }
    return { connection, table: await table };
  };

  return {
    async get(sessionId) {
      const { connection, table } = await database();
      const row = await connection.get<{ record: string }>(
        `SELECT record FROM ${table} WHERE id = ?`,
        [sessionId],
      );
      return row ? (JSON.parse(row.record) as SessionStoreRecord<TSession>) : undefined;
    },
    async set(record) {
      const { connection, table } = await database();
      await connection.execute(
        `INSERT INTO ${table} (id, record, expires_at) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET record = excluded.record, expires_at = excluded.expires_at`,
        [record.id, JSON.stringify(record), record.expiresAt],
      );
      const now = Date.now();
      if (now - lastPurge > PURGE_EVERY_MS) {
        lastPurge = now;
        await connection.execute(`DELETE FROM ${table} WHERE expires_at <= ?`, [
          new Date(now).toISOString(),
        ]);
      }
    },
    async delete(sessionId) {
      const { connection, table } = await database();
      await connection.execute(`DELETE FROM ${table} WHERE id = ?`, [sessionId]);
    },
  };
}
