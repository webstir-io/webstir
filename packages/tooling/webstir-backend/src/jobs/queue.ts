import { randomUUID } from 'node:crypto';

import type { Database } from '../db/database.js';

export interface EnqueueOptions {
  /** Wait this long before the first try. */
  readonly delaySeconds?: number;
  /** Give up after this many tries (default 5). */
  readonly maxAttempts?: number;
}

export interface QueuedJob {
  readonly id: string;
  readonly name: string;
  readonly payload: unknown;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export interface JobRecord {
  readonly id: string;
  readonly name: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runAt: string;
  readonly lastError?: string;
  readonly updatedAt: string;
}

export const DEFAULT_MAX_ATTEMPTS = 5;
const FIRST_RETRY_MS = 30_000;
const LONGEST_RETRY_MS = 60 * 60 * 1000;
const KEEP_DONE_MS = 7 * 24 * 60 * 60 * 1000;

export async function insertJob(
  db: Database,
  name: string,
  payload: unknown,
  options: EnqueueOptions = {},
  now = new Date(),
): Promise<string> {
  const id = randomUUID();
  const stamp = now.toISOString();
  const runAt = new Date(now.getTime() + Math.max(0, options.delaySeconds ?? 0) * 1000);
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  await db.execute(
    `INSERT INTO webstir_jobs (id, name, payload, status, attempts, max_attempts, run_at, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
    [
      id,
      name,
      payload === undefined ? null : JSON.stringify(payload),
      maxAttempts,
      runAt.toISOString(),
      stamp,
      stamp,
    ],
  );
  return id;
}

/** Takes the job due first, marking it running and counting the try. */
export async function claimJob(db: Database, now = new Date()): Promise<QueuedJob | undefined> {
  const stamp = now.toISOString();
  const row = await db.get<{
    id: string;
    name: string;
    payload: string | null;
    attempts: number;
    max_attempts: number;
  }>(
    `UPDATE webstir_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
     WHERE status = 'queued' AND id = (
       SELECT id FROM webstir_jobs WHERE status = 'queued' AND run_at <= ?
       ORDER BY run_at, created_at LIMIT 1
     )
     RETURNING id, name, payload, attempts, max_attempts`,
    [stamp, stamp],
  );
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    payload: row.payload === null ? undefined : JSON.parse(row.payload),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
  };
}

export async function completeJob(db: Database, id: string, now = new Date()): Promise<void> {
  await db.execute(
    `UPDATE webstir_jobs SET status = 'done', last_error = NULL, updated_at = ? WHERE id = ?`,
    [now.toISOString(), id],
  );
}

/** Queues the job again after a wait that doubles with each try, or gives up after its last. */
export async function failJob(
  db: Database,
  job: QueuedJob,
  error: unknown,
  now = new Date(),
): Promise<'retry' | 'failed'> {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (job.attempts >= job.maxAttempts) {
    await db.execute(
      `UPDATE webstir_jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`,
      [message, now.toISOString(), job.id],
    );
    return 'failed';
  }
  const wait = Math.min(FIRST_RETRY_MS * 2 ** (job.attempts - 1), LONGEST_RETRY_MS);
  await db.execute(
    `UPDATE webstir_jobs SET status = 'queued', last_error = ?, run_at = ?, updated_at = ? WHERE id = ?`,
    [message, new Date(now.getTime() + wait).toISOString(), now.toISOString(), job.id],
  );
  return 'retry';
}

/** Jobs a stopped process was running go back in the queue; old finished jobs are dropped. */
export async function tidyJobs(db: Database, now = new Date()): Promise<void> {
  await db.execute(`UPDATE webstir_jobs SET status = 'queued' WHERE status = 'running'`);
  await db.execute(`DELETE FROM webstir_jobs WHERE status = 'done' AND updated_at <= ?`, [
    new Date(now.getTime() - KEEP_DONE_MS).toISOString(),
  ]);
}

export async function listJobRecords(
  db: Database,
  status?: JobRecord['status'],
): Promise<JobRecord[]> {
  const rows = await db.query<{
    id: string;
    name: string;
    status: JobRecord['status'];
    attempts: number;
    max_attempts: number;
    run_at: string;
    last_error: string | null;
    updated_at: string;
  }>(
    `SELECT id, name, status, attempts, max_attempts, run_at, last_error, updated_at FROM webstir_jobs
     ${status ? 'WHERE status = ?' : ''} ORDER BY updated_at DESC LIMIT 100`,
    status ? [status] : [],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    runAt: row.run_at,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    updatedAt: row.updated_at,
  }));
}
