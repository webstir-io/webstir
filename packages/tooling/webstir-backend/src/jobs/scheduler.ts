import type { JobDefinition } from './registry.js';
import { nextRun, parseSchedule } from './schedule.js';

export interface JobLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// setTimeout holds at most about 24.8 days; a later run waits in steps.
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Runs each scheduled job when its schedule says, in this process. A run still going when the next
 * is due is skipped, not overlapped.
 */
export function startScheduler(options: {
  readonly jobs: readonly JobDefinition[];
  readonly run: (name: string) => Promise<void>;
  readonly logger: JobLogger;
}): { stop(): void } {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;

  for (const job of options.jobs) {
    if (!job.schedule) continue;
    const schedule = parseSchedule(job.schedule);
    if (!schedule) {
      options.logger.warn(
        `[jobs] ${job.name} has schedule "${job.schedule}", which is not a schedule; it will not run on its own.`,
      );
      continue;
    }
    let running = false;
    const runOnce = async () => {
      if (running) {
        options.logger.warn(`[jobs] ${job.name} is still running; skipping this run.`);
        return;
      }
      running = true;
      try {
        await options.run(job.name);
      } finally {
        running = false;
      }
    };
    const wait = (at: Date) => {
      if (stopped) return;
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          if (at.getTime() > Date.now()) {
            wait(at);
            return;
          }
          void runOnce();
          const next = nextRun(schedule, at);
          if (next) wait(next);
        },
        Math.min(Math.max(0, at.getTime() - Date.now()), MAX_TIMEOUT_MS),
      );
      timers.add(timer);
    };
    if (schedule.kind === 'reboot') {
      void runOnce();
      continue;
    }
    const first = nextRun(schedule, new Date());
    if (first) wait(first);
  }

  return {
    stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
