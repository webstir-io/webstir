import { appDatabase, declareWebstirTables } from '../db/app-database.js';
import type { DatabaseConnection } from '../db/database.js';
import { ensureWebstirTables } from '../db/webstir-tables.js';
import type { SignInOptions } from './module.js';

/** The app's database, with the users and sign-in tables in it. */
export async function signInDatabase(): Promise<DatabaseConnection> {
  const connection = await appDatabase();
  await ensureWebstirTables(connection, 'sign-in');
  return connection;
}

/**
 * Sign-in's tables are made when the database opens, before the app's migrations, so those can
 * reference `users (id)`; an app whose migrations make `users` gets them after, when first used.
 */
export function declareSignInTables(options: SignInOptions): void {
  if (options.usersTable !== 'app') declareWebstirTables('sign-in');
}
