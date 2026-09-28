import type { DatabaseConnection } from '../db/database.js';
import { ensureWebstirTables } from '../db/webstir-tables.js';
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
  const database = async () => {
    const connection = await connect();
    await ensureWebstirTables(connection, 'sessions');
    return connection;
  };

  return {
    async get(sessionId) {
      const row = await (await database()).get<{ record: string }>(
        'SELECT record FROM webstir_sessions WHERE id = ?',
        [sessionId],
      );
      return row ? (JSON.parse(row.record) as SessionStoreRecord<TSession>) : undefined;
    },
    async set(record) {
      const connection = await database();
      await connection.transaction(async (tx) => {
        await tx.execute('DELETE FROM webstir_sessions WHERE id = ?', [record.id]);
        await tx.execute('INSERT INTO webstir_sessions (id, record, expires_at) VALUES (?, ?, ?)', [
          record.id,
          JSON.stringify(record),
          record.expiresAt,
        ]);
      });
      const now = Date.now();
      if (now - lastPurge > PURGE_EVERY_MS) {
        lastPurge = now;
        await connection.execute('DELETE FROM webstir_sessions WHERE expires_at <= ?', [
          new Date(now).toISOString(),
        ]);
      }
    },
    async delete(sessionId) {
      await (await database()).execute('DELETE FROM webstir_sessions WHERE id = ?', [sessionId]);
    },
  };
}
