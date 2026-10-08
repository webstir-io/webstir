import type { Database } from '../db/database.js';
import { findOrCreateUser, findUser, type SessionUserRef } from './users.js';

/** The user a provider's person signed in as before, with the address the app knows them by. */
export async function findIdentityUser(
  db: Database,
  provider: string,
  subject: string,
): Promise<(SessionUserRef & { readonly email: string }) | undefined> {
  // Joined, so an identity whose user is gone finds nobody and is linked again.
  const row = await db.get<{ id: string; email: string; session_version: number }>(
    `SELECT u.id, u.email, u.session_version
       FROM webstir_sign_in_identities i JOIN users u ON u.id = i.user_id
      WHERE i.provider = ? AND i.subject = ?`,
    [provider, subject],
  );
  return row
    ? { id: String(row.id), version: Number(row.session_version), email: row.email }
    : undefined;
}

/**
 * A provider's person, signing in for the first time, becomes the user with their address: the
 * one there already, or a new one when `create` allows. Without either there is nobody to be.
 */
export async function linkIdentity(
  db: Database,
  identity: { readonly provider: string; readonly subject: string; readonly email: string },
  options: { readonly create: boolean },
): Promise<SessionUserRef | undefined> {
  const user = options.create
    ? await findOrCreateUser(db, identity.email)
    : await findUser(db, identity.email);
  if (!user) return undefined;
  await db.execute(
    `INSERT INTO webstir_sign_in_identities (provider, subject, user_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (provider, subject) DO UPDATE SET user_id = excluded.user_id`,
    [identity.provider, identity.subject, user.id, new Date().toISOString()],
  );
  return user;
}
