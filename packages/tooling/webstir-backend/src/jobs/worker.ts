import { AsyncResource } from 'node:async_hooks';

import type { Database } from '../db/database.js';
import { claimJob, completeJob, failJob, tidyJobs } from './queue.js';
import type { JobContext } from './registry.js';
import type { JobLogger } from './scheduler.js';

export interface JobWorker {
  /** Looks for due jobs now instead of at the next poll. */
  wake(): void;
  stop(): Promise<void>;
}

/** Runs queued jobs in this process, one at a time, as they come due. */
export function startWorker(options: {
  readonly db: Database;
  readonly run: (name: string, payload: unknown, context: JobContext) => Promise<unknown>;
  readonly logger: JobLogger;
  readonly pollMs?: number;
}): JobWorker {
  const pollMs = options.pollMs ?? 1000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let working: Promise<void> | undefined;
  let again = false;

  const drain = async () => {
    for (;;) {
      if (stopped) return;
      const job = await claimJob(options.db);
      if (!job) return;
      try {
        await options.run(job.name, job.payload, { name: job.name, attempt: job.attempts });
        await completeJob(options.db, job.id);
      } catch (error) {
        const outcome = await failJob(options.db, job, error);
        options.logger.error(
          `[jobs] ${job.name} failed (try ${job.attempts} of ${job.maxAttempts}${outcome === 'retry' ? ', will retry' : ', giving up'}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  const tick = () => {
    if (stopped) return;
    if (working) {
      again = true;
      return;
    }
    clearTimeout(timer);
    working = drain()
      .catch((error) =>
        options.logger.error(
          `[jobs] queue check failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
      .finally(() => {
        working = undefined;
        if (again) {
          again = false;
          tick();
        } else if (!stopped) {
          timer = setTimeout(tick, pollMs);
        }
      });
  };

  void tidyJobs(options.db)
    .catch((error) =>
      options.logger.error(
        `[jobs] could not tidy the queue: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
    .then(tick);

  return {
    // Bound to where the worker started: code that queues a job inside a transaction wakes the
    // worker outside it, so the job runs only once that transaction commits.
    wake: AsyncResource.bind(tick),
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await working;
    },
  };
}
