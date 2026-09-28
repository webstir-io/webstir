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
}

/**
 * A code and a link token for this address, stored only as hashes, expiring in five minutes. It
 * replaces the address's open ones. Undefined when the address asked too often: once a minute, and
 * five times in fifteen minutes.
 */
export async function createChallenge(
  db: Database,
  email: string,
  secret: string,
  now = new Date(),
): Promise<Challenge | undefined> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const token = randomBytes(32).toString('base64url');
  const stamp = now.toISOString();
  return db.transaction(async (tx) => {
    const recent = await tx.query<{ created_at: string }>(
      'SELECT created_at FROM webstir_sign_in_challenges WHERE email = ? AND created_at > ?',
      [email, new Date(now.getTime() - 15 * 60_000).toISOString()],
    );
    const lastMinute = new Date(now.getTime() - 60_000).toISOString();
    if (
      recent.length >= PER_QUARTER_HOUR ||
      recent.filter((row) => row.created_at > lastMinute).length >= PER_MINUTE
    ) {
      return undefined;
    }
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
    return { code, token };
  });
}

/** Whether the code is this address's current one; three wrong tries use it up. */
export async function consumeCode(
  db: Database,
  email: string,
  code: string,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  const stamp = now.toISOString();
  return db.transaction(async (tx) => {
    const open = await tx.get<ChallengeRow>(
      `SELECT id, email, code_hash, attempts_remaining FROM webstir_sign_in_challenges
       WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      [email, stamp],
    );
    const given = hash(secret, `code\n${email}\n${code}`);
    if (!open) return false;
    if (!same(open.code_hash, given)) {
      const left = Number(open.attempts_remaining) - 1;
      await tx.execute(
        'UPDATE webstir_sign_in_challenges SET attempts_remaining = ?, consumed_at = ? WHERE id = ?',
        [Math.max(0, left), left <= 0 ? stamp : null, open.id],
      );
      return false;
    }
    await consumeAll(tx, email, stamp);
    return true;
  });
}

/** The address a link token signs in, once. */
export async function consumeToken(
  db: Database,
  token: string,
  secret: string,
  now = new Date(),
): Promise<string | undefined> {
  const stamp = now.toISOString();
  return db.transaction(async (tx) => {
    const open = await tx.get<ChallengeRow>(
      `SELECT id, email, code_hash, attempts_remaining FROM webstir_sign_in_challenges
       WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
      [hash(secret, `token\n${token}`), stamp],
    );
    if (!open) return undefined;
    await consumeAll(tx, open.email, stamp);
    return open.email;
  });
}

/** Work shaped like making a challenge, for an address that gets none, so timing tells nothing. */
export function spendLikeAChallenge(secret: string, email: string): void {
  hash(secret, `token\n${randomBytes(32).toString('base64url')}`);
  hash(secret, `code\n${email}\n000000`);
}

async function consumeAll(db: Database, email: string, stamp: string): Promise<void> {
  await db.execute(
    'UPDATE webstir_sign_in_challenges SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL',
    [stamp, email],
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
