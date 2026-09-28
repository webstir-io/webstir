import { openDatabase } from '../../dist/db/index.js';

/** SQLite always; Postgres too when TEST_DATABASE_URL names one (CI runs a service container). */
export const databaseTargets = [
  { name: 'sqlite', url: ':memory:' },
  ...(process.env.TEST_DATABASE_URL
    ? [{ name: 'postgres', url: process.env.TEST_DATABASE_URL }]
    : []),
];

/** A connection with none of Webstir's tables in it yet. */
export async function openEmptyDatabase(target) {
  const db = await openDatabase(target.url, { workspaceRoot: '/' });
  if (db.dialect === 'postgres') {
    await db.exec(
      'DROP TABLE IF EXISTS webstir_jobs, webstir_sign_in_challenges, webstir_sessions, users, webstir_migrations CASCADE',
    );
  }
  return db;
}
