import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Database } from '../db/database.js';

export const CODE_MINUTES = 5;
const ATTEMPTS = 3;
const PER_MINUTE = 1;
const PER_QUARTER_HOUR = 5;

export interface Challenge {
  readonly code: string;
  readonly token: string;
}

interface ChallengeRow {
  id: string;
  email: string;
  code_hash: string;
  attempts_remaining: number;
  created_at: string;
}

/** Thrown to undo a challenge made only to take the time a real one takes. */
class Rehearsal extends Error {}

/**
 * A code and a link token for this address, stored only as hashes, expiring in five minutes. It
 * replaces the address's open ones. Undefined when the address may not sign in (`allowed: false`)
 * or asked too often: once a minute, and five times in fifteen minutes. Those do the same work and
 * roll it back, so how long the answer takes says nothing about the address.
 */
export async function createChallenge(
  db: Database,
  email: string,
  secret: string,
  now = new Date(),
  options: { readonly allowed?: boolean } = {},
): Promise<Challenge | undefined> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const token = randomBytes(32).toString('base64url');
  const stamp = now.toISOString();
  try {
    return await db.transaction(async (tx) => {
      const recent = await tx.query<{ created_at: string }>(
        'SELECT created_at FROM webstir_sign_in_challenges WHERE email = ? AND created_at > ?',
        [email, new Date(now.getTime() - 15 * 60_000).toISOString()],
      );
      const lastMinute = new Date(now.getTime() - 60_000).toISOString();
      const limited =
        recent.length >= PER_QUARTER_HOUR ||
        recent.filter((row) => row.created_at > lastMinute).length >= PER_MINUTE;
      await tx.execute(
        'UPDATE webstir_sign_in_challenges SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL',
        [stamp, email],
      );
      await tx.execute(
        `INSERT INTO webstir_sign_in_challenges
           (id, email, token_hash, code_hash, attempts_remaining, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          email,
          hash(secret, `token\n${token}`),
          hash(secret, `code\n${email}\n${code}`),
          ATTEMPTS,
          stamp,
          new Date(now.getTime() + CODE_MINUTES * 60_000).toISOString(),
        ],
      );
      if (limited || options.allowed === false) throw new Rehearsal();
      return { code, token };
    });
  } catch (error) {
    if (error instanceof Rehearsal) return undefined;
    throw error;
  }
}

/**
 * Whether the code is this address's current one; three wrong tries use it up. Each outcome is one
 * conditional update, so sign-ins at the same moment cannot both use a code, or lose a wrong try.
 */
export async function consumeCode(
  db: Database,
  email: string,
  code: string,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  const stamp = now.toISOString();
  const open = await db.get<ChallengeRow>(
    `SELECT id, email, code_hash, attempts_remaining, created_at FROM webstir_sign_in_challenges
     WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    [email, stamp],
  );
  if (!open) return false;
  if (!same(open.code_hash, hash(secret, `code\n${email}\n${code}`))) {
    await db.execute(
      `UPDATE webstir_sign_in_challenges
       SET attempts_remaining = attempts_remaining - 1,
           consumed_at = CASE WHEN attempts_remaining <= 1 THEN ? ELSE consumed_at END
       WHERE id = ? AND consumed_at IS NULL`,
      [stamp, open.id],
    );
    return false;
  }
  const { changes } = await db.execute(
    `UPDATE webstir_sign_in_challenges SET consumed_at = ?
     WHERE id = ? AND consumed_at IS NULL AND attempts_remaining > 0 AND expires_at > ?`,
    [stamp, open.id, stamp],
  );
  if (changes !== 1) return false;
  await consumeOlder(db, email, open.created_at, stamp);
  return true;
}

/** The address a link token signs in, once: the update that uses it up is the check. */
export async function consumeToken(
  db: Database,
  token: string,
  secret: string,
  now = new Date(),
): Promise<string | undefined> {
  const stamp = now.toISOString();
  const used = await db.get<{ email: string; created_at: string }>(
    `UPDATE webstir_sign_in_challenges SET consumed_at = ?
     WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
     RETURNING email, created_at`,
    [stamp, hash(secret, `token\n${token}`), stamp],
  );
  if (!used) return undefined;
  await consumeOlder(db, used.email, used.created_at, stamp);
  return used.email;
}

/** Uses up the address's codes sent no later than the one just used; one sent since stays good. */
async function consumeOlder(
  db: Database,
  email: string,
  createdAt: string,
  stamp: string,
): Promise<void> {
  await db.execute(
    `UPDATE webstir_sign_in_challenges SET consumed_at = ?
     WHERE email = ? AND consumed_at IS NULL AND created_at <= ?`,
    [stamp, email, createdAt],
  );
}

function hash(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function same(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
