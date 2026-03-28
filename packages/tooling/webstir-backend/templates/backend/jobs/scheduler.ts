#!/usr/bin/env bun
import { clearTimeout, setInterval, setTimeout } from 'node:timers';

import { loadJobs } from './runtime.js';

const args = process.argv.slice(2);
const MAX_TIMEOUT_MS = 2_147_483_647;
const RAN_ONCE = 'ran-once';

type ScheduledJobHandle =
  | ReturnType<typeof setInterval>
  | {
      [Symbol.dispose](): void;
    };

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const jobs = await loadJobs();
  if (jobs.length === 0) {
    console.info('[jobs] no jobs registered in webstir.moduleManifest.jobs');
    return;
  }

  const asJson = args.includes('--json');
  if (args.includes('--list') || asJson) {
    listJobs(jobs, { asJson });
    return;
  }

  const jobName = parseOption('--job');
  const watch = args.includes('--watch');
  const runAll = args.includes('--all') || (!jobName && !watch);

  if (watch) {
    await startWatch(jobs, jobName);
    return;
  }

  if (jobName) {
    await runNamedJob(jobs, jobName);
    return;
  }

  if (runAll) {
    for (const job of jobs) {
      await runJob(job);
    }
    return;
  }
}

async function startWatch(jobs: Awaited<ReturnType<typeof loadJobs>>, jobName?: string) {
  const filtered = jobName ? jobs.filter((job) => job.name === jobName) : jobs;
  if (filtered.length === 0) {
    console.error(
      jobName ? `[jobs] job '${jobName}' not found` : '[jobs] no jobs available to watch',
    );
    process.exitCode = 1;
    return;
  }

  const timers = filtered.map((job) => scheduleJob(job));
  const hasActiveWatch = timers.some((timer) => timer !== undefined && timer !== RAN_ONCE);
  if (!hasActiveWatch) {
    if (timers.includes(RAN_ONCE)) {
      console.info('[jobs] completed @reboot jobs and exiting.');
      return;
    }
    console.warn(
      '[jobs] no jobs have schedules compatible with the built-in watcher. Use --json to export job metadata for an external scheduler.',
    );
    return;
  }

  console.info('[jobs] watching jobs:', filtered.map((job) => job.name).join(', '));
  process.stdin.resume();
}

function scheduleJob(
  job: Awaited<ReturnType<typeof loadJobs>>[number],
): ScheduledJobHandle | typeof RAN_ONCE | undefined {
  const schedule = normalizeSchedule(job.schedule);
  if (!schedule) {
    console.info(
      `[jobs] schedule '${job.schedule ?? 'unspecified'}' is not supported by the built-in watcher. Run manually or use --json with an external scheduler.`,
    );
    return undefined;
  }

  if (schedule.kind === 'reboot') {
    void runJob(job);
    return RAN_ONCE;
  }

  if (schedule.kind === 'rate') {
    void runJob(job);
    return setInterval(() => {
      void runJob(job);
    }, schedule.intervalMs);
  }

  return scheduleCronJob(job, schedule.expression);
}

async function runNamedJob(jobs: Awaited<ReturnType<typeof loadJobs>>, jobName: string) {
  const job = jobs.find((item) => item.name === jobName);
  if (!job) {
    console.error(`[jobs] job '${jobName}' not found`);
    process.exitCode = 1;
    return;
  }
  await runJob(job);
}

async function runJob(job: Awaited<ReturnType<typeof loadJobs>>[number]) {
  const startedAt = new Date();
  console.info(`[jobs] running ${job.name} (schedule: ${job.schedule ?? 'manual'})`);
  try {
    await job.run();
    console.info(
      `[jobs] ${job.name} completed in ${(Date.now() - startedAt.getTime()).toFixed(0)}ms`,
    );
  } catch (error) {
    console.error(`[jobs] ${job.name} failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

function listJobs(jobs: Awaited<ReturnType<typeof loadJobs>>, options: { asJson?: boolean } = {}) {
  if (options.asJson) {
    console.info(
      JSON.stringify(
        jobs.map(({ run: _run, ...job }) => job),
        null,
        2,
      ),
    );
    return;
  }

  for (const job of jobs) {
    console.info(
      `- ${job.name}${job.schedule ? ` (${job.schedule})` : ''}${job.description ? ` — ${job.description}` : ''}`,
    );
  }
}

function parseOption(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith('-')) {
    return args[index + 1];
  }
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  return undefined;
}

function normalizeSchedule(
  schedule: string | undefined,
):
  | { kind: 'cron'; expression: string }
  | { kind: 'rate'; intervalMs: number }
  | { kind: 'reboot' }
  | undefined {
  if (!schedule) {
    return undefined;
  }
  const trimmed = schedule.trim().toLowerCase();
  if (!trimmed) return undefined;

  if (trimmed.startsWith('@')) {
    if (trimmed === '@reboot') {
      return { kind: 'reboot' };
    }
    return isSupportedCronExpression(trimmed) ? { kind: 'cron', expression: trimmed } : undefined;
  }

  const rateMatch = /^rate\((\d+)\s+(second|seconds|minute|minutes|hour|hours)\)$/.exec(trimmed);
  if (rateMatch) {
    const value = Number(rateMatch[1]);
    const unit = rateMatch[2];
    const multiplier = unit.startsWith('second')
      ? 1000
      : unit.startsWith('minute')
        ? 60 * 1000
        : unit.startsWith('hour')
          ? 60 * 60 * 1000
          : 0;
    if (value > 0 && multiplier > 0) {
      return { kind: 'rate', intervalMs: value * multiplier };
    }
    return undefined;
  }

  return isSupportedCronExpression(trimmed) ? { kind: 'cron', expression: trimmed } : undefined;
}

function isSupportedCronExpression(expression: string): boolean {
  try {
    return Bun.cron.parse(expression) !== null;
  } catch {
    return false;
  }
}

function scheduleCronJob(job: Awaited<ReturnType<typeof loadJobs>>[number], expression: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const queueNext = (relativeTo?: Date) => {
    if (stopped) {
      return;
    }

    const nextRun = Bun.cron.parse(expression, relativeTo);
    if (!nextRun) {
      console.warn(
        `[jobs] schedule '${expression}' does not produce a future run time. Stopping local watch for ${job.name}.`,
      );
      return;
    }
    scheduleTimeout(nextRun, async () => {
      await runJob(job);
      queueNext(nextRun);
    });
  };

  const scheduleTimeout = (nextRun: Date, callback: () => Promise<void>) => {
    const remainingMs = nextRun.getTime() - Date.now();
    const delayMs = Math.max(0, Math.min(remainingMs, MAX_TIMEOUT_MS));
    timer = setTimeout(() => {
      if (stopped) {
        return;
      }
      if (remainingMs > MAX_TIMEOUT_MS && nextRun.getTime() > Date.now()) {
        scheduleTimeout(nextRun, callback);
        return;
      }
      void callback();
    }, delayMs);
  };

  queueNext();

  return {
    [Symbol.dispose]() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}

function printHelp() {
  console.info(`Usage:
  bun src/backend/jobs/scheduler.ts [--list]
  bun build/backend/jobs/scheduler.js --job <name>
  bun build/backend/jobs/scheduler.js --watch [--job <name>]

Options:
  --list            Show registered jobs and exit
  --json            Print registered job metadata as JSON for external schedulers
  --job <name>      Run a specific job immediately (or watch a single job)
  --all             Run all jobs once (default when no options are provided)
  --watch           Watch jobs locally (supports cron expressions, cron nicknames, @reboot, and rate(...) syntax)
  --help            Display this message
`);
}

const isMain = (() => {
  try {
    const argv1 = process.argv?.[1];
    if (!argv1) return false;
    const here = new URL(import.meta.url);
    const run = new URL(`file://${argv1}`);
    return here.pathname === run.pathname;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((error) => {
    console.error('[jobs] scheduler failed:', error);
    process.exitCode = 1;
  });
}
