import { appDatabase } from '../db/app-database.js';
import type { DatabaseConnection } from '../db/database.js';
import { ensureWebstirTables } from '../db/webstir-tables.js';

/** The app's database, with the users and sign-in tables in it. */
export async function signInDatabase(): Promise<DatabaseConnection> {
  const connection = await appDatabase();
  await ensureWebstirTables(connection, 'sign-in');
  return connection;
}
