import { randomUUID } from 'node:crypto';

import type { Database } from '../db/database.js';

/** The signed-in person, as handlers and views see them in `ctx.user`. */
export interface SessionUser {
  readonly id: string;
  readonly email: string;
}

interface UserRow {
  id: string;
  email: string;
  session_version: number;
}

/** What a session keeps of its user: who, and which of their sign-ins it belongs to. */
export interface SessionUserRef {
  readonly id: string;
  readonly version: number;
}

export const SESSION_USER_KEY = 'webstirUser';

export function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : undefined;
}

export async function findOrCreateUser(db: Database, email: string): Promise<SessionUserRef> {
  const existing = await db.get<UserRow>(
    'SELECT id, email, session_version FROM users WHERE email = ?',
    [email],
  );
  if (existing) return { id: String(existing.id), version: Number(existing.session_version) };
  try {
    const id = randomUUID();
    await db.execute(
      'INSERT INTO users (id, email, session_version, created_at) VALUES (?, ?, 1, ?)',
      [id, email, new Date().toISOString()],
    );
    return { id, version: 1 };
  } catch (error) {
    // Two first sign-ins at once: the other one made the user.
    const made = await db.get<UserRow>(
      'SELECT id, email, session_version FROM users WHERE email = ?',
      [email],
    );
    if (made) return { id: String(made.id), version: Number(made.session_version) };
    throw error;
  }
}

/** The session's user, while the session still belongs to their current sign-ins. */
export async function loadSessionUser(
  db: Database,
  ref: SessionUserRef,
): Promise<SessionUser | undefined> {
  const row = await db.get<UserRow>('SELECT id, email, session_version FROM users WHERE id = ?', [
    ref.id,
  ]);
  if (!row || Number(row.session_version) !== ref.version) return undefined;
  return { id: String(row.id), email: row.email };
}

/** Ends every session of this user, on every device. */
export async function signOutEverywhere(db: Database, userId: string): Promise<void> {
  await db.execute('UPDATE users SET session_version = session_version + 1 WHERE id = ?', [userId]);
}

export function readSessionUserRef(
  session: Record<string, unknown> | null,
): SessionUserRef | undefined {
  const value = session?.[SESSION_USER_KEY] as Partial<SessionUserRef> | undefined;
  return value && typeof value.id === 'string' && typeof value.version === 'number'
    ? { id: value.id, version: value.version }
    : undefined;
}
