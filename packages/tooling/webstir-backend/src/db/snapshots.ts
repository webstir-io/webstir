import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { appRoot } from '../app/app-root.js';
import { storeAt } from '../files/index.js';
import { resolveDatabaseTarget, type DatabaseConnection } from './database.js';

/**
 * Snapshots of a SQLite app database: `SNAPSHOT_URL=s3://bucket/prefix` or `file:./data/snapshots`
 * keeps a consistent copy (`VACUUM INTO`) of the database there after the app writes to it. At
 * most one copy is taken at a time, and writes made while it runs lead to one more after it.
 * `SNAPSHOT_KEEP=48` keeps only the newest 48; by default every copy stays, for the bucket's own
 * lifecycle rules to expire. A Postgres database is the host's to back up.
 */

// Writes close together share one copy.
const SETTLE_MS = 1_000;
const ATTEMPTS = 3;

interface Snapshotter {
  /** Takes a copy soon, sharing it with other writes made meanwhile. */
  schedule(): void;
  /** Takes a copy now, after any already underway, and waits for it. */
  now(): Promise<string | undefined>;
  /** Waits for a copy that is scheduled or underway. */
  flush(): Promise<void>;
}

let snapshotter: Snapshotter | undefined;

/** The app's snapshotter, when SNAPSHOT_URL is set and the database is SQLite. */
export function databaseSnapshots(
  connection: () => Promise<DatabaseConnection>,
  databaseUrl: string,
): Snapshotter | undefined {
  const url = process.env.SNAPSHOT_URL?.trim();
  if (!url) return undefined;
  const target = resolveDatabaseTarget(databaseUrl, appRoot());
  if (target.dialect !== 'sqlite' || target.location === ':memory:') return undefined;
  snapshotter ??= createSnapshotter(url, connection);
  return snapshotter;
}

/** Waits for a copy that is scheduled or underway, then forgets the snapshotter. */
export async function closeDatabaseSnapshots(): Promise<void> {
  const current = snapshotter;
  snapshotter = undefined;
  await current?.flush();
}

function createSnapshotter(
  url: string,
  connection: () => Promise<DatabaseConnection>,
): Snapshotter {
  const store = storeAt(url);
  const keep = Number.parseInt(process.env.SNAPSHOT_KEEP ?? '', 10);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<string | undefined> | undefined;
  let again = false;

  const take = async (): Promise<string | undefined> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const key = await capture(store, await connection());
        if (Number.isInteger(keep) && keep > 0) await prune(store, keep);
        return key;
      } catch (error) {
        if (attempt >= ATTEMPTS) {
          console.error(
            `[webstir-backend] database snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
  };

  const run = (): Promise<string | undefined> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let key: string | undefined;
      do {
        again = false;
        key = await take();
      } while (again);
      return key;
    })().finally(() => {
      running = undefined;
    });
    return running;
  };

  return {
    schedule() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, SETTLE_MS);
      timer.unref?.();
    },
    now() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      return run();
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        await run();
      } else if (running) {
        await running;
      }
    },
  };
}

/** A consistent copy of the database, taken while it stays open for everyone else. */
async function capture(
  store: ReturnType<typeof storeAt>,
  connection: DatabaseConnection,
): Promise<string> {
  // A folder only this user can read: the copy holds everything in the database.
  const folder = await mkdtemp(path.join(tmpdir(), 'webstir-snapshot-'));
  try {
    const file = path.join(folder, 'app.sqlite');
    await connection.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    const key = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`;
    await store.put(key, await readFile(file), {
      contentType: 'application/vnd.sqlite3',
      ifAbsent: true,
      metadata: { 'snapshot-schema': '1' },
    });
    return key;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Deletes all but the newest `keep` copies; their keys start with when they were taken. */
async function prune(store: ReturnType<typeof storeAt>, keep: number): Promise<void> {
  const keys = (await store.list()).filter((key) => key.endsWith('.sqlite')).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - keep))) {
    await store.delete(key);
  }
}
