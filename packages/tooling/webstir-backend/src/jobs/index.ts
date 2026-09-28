import { appRoot } from '../app/app-root.js';
import { appDatabase, appDatabaseExists, onAppDatabaseOpen } from '../db/app-database.js';
import { ensureWebstirTables } from '../db/webstir-tables.js';
import { insertJob, listJobRecords, type EnqueueOptions, type JobRecord } from './queue.js';
import { hasJob, loadJobRunner, readJobs, type JobContext } from './registry.js';
import { startScheduler, type JobLogger } from './scheduler.js';
import { startWorker, type JobWorker } from './worker.js';

export type { EnqueueOptions, JobRecord } from './queue.js';
export type { JobContext, JobDefinition, JobRunner } from './registry.js';
export { readJobs } from './registry.js';
export { parseSchedule } from './schedule.js';

let worker: JobWorker | undefined;

export interface Jobs {
  /**
   * Queues a job to run later in the server, with retries: `jobs.enqueue('send-invoice', { id })`.
   * The job is `src/backend/jobs/<name>/index.ts`, and its `run(payload)` gets the payload back.
   */
  enqueue(name: string, payload?: unknown, options?: EnqueueOptions): Promise<string>;
  /** Runs a job now, in this process, and waits for it. */
  run(name: string, payload?: unknown): Promise<void>;
}

export const jobs: Jobs = {
  async enqueue(name, payload, options) {
    if (!hasJob(appRoot(), name)) {
      throw new Error(`there is no job "${name}"; add src/backend/jobs/${name}/index.ts`);
    }
    const connection = await appDatabase();
    await ensureWebstirTables(connection, 'jobs');
    const id = await insertJob(connection, name, payload, options);
    worker?.wake();
    return id;
  },
  async run(name, payload) {
    await runJob(name, payload, { name, attempt: 1 });
  },
};

/** The queue's recent jobs, newest first: all, or those with one status. */
export async function listQueuedJobs(status?: JobRecord['status']): Promise<JobRecord[]> {
  const connection = await appDatabase();
  await ensureWebstirTables(connection, 'jobs');
  return listJobRecords(connection, status);
}

async function runJob(name: string, payload: unknown, context: JobContext): Promise<void> {
  const run = await loadJobRunner(appRoot(), name);
  await run(payload, context);
}

/**
 * Starts the app's jobs in the server: scheduled jobs on their schedules, and a worker for the queue
 * once the database is open. `WEBSTIR_JOBS=off` leaves both off, for a process that should not run
 * jobs, such as a second server.
 */
export function startJobs(logger: JobLogger): { stop(): Promise<void> } {
  const off = ['off', '0', 'false', 'no'].includes(
    (process.env.WEBSTIR_JOBS ?? '').trim().toLowerCase(),
  );
  const definitions = off ? [] : readJobs(appRoot());
  if (definitions.length === 0) return { stop: async () => undefined };

  const scheduler = startScheduler({
    jobs: definitions,
    logger,
    run: async (name) => {
      const started = Date.now();
      try {
        await runJob(name, undefined, { name, attempt: 1 });
        logger.info(`[jobs] ${name} finished in ${Date.now() - started}ms`);
      } catch (error) {
        logger.error(
          `[jobs] ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  });
  // The queue's tables are made when the database opens.
  const unsubscribe = onAppDatabaseOpen((connection) => {
    worker ??= startWorker({ db: connection, logger, run: runJob });
  });
  // Jobs queued before a restart still run.
  if (appDatabaseExists()) void appDatabase().catch(() => undefined);

  return {
    async stop() {
      scheduler.stop();
      unsubscribe();
      await worker?.stop();
      worker = undefined;
    },
  };
}
