import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { ensureWebstirTables } from '../dist/db/webstir-tables.js';
import { claimJob, failJob, insertJob, listJobRecords, tidyJobs } from '../dist/jobs/queue.js';
import { parseSchedule } from '../dist/jobs/schedule.js';
import { startScheduler } from '../dist/jobs/scheduler.js';
import { startWorker } from '../dist/jobs/worker.js';
import { databaseTargets, openEmptyDatabase } from './support/databases.js';

async function queue(target) {
  const db = await openEmptyDatabase(target);
  await ensureWebstirTables(db, 'jobs');
  return db;
}

const quiet = { info() {}, warn() {}, error() {} };

test('schedules: cron, nicknames, @reboot and rate(); anything else is not one', () => {
  for (const [text, kind] of [
    ['0 3 * * *', 'cron'],
    ['@daily', 'cron'],
    ['@reboot', 'reboot'],
    ['rate(5 minutes)', 'rate'],
    ['rate(1 second)', 'rate'],
    ['every day', undefined],
    ['rate(0 minutes)', undefined],
    ['61 * * * *', undefined],
  ]) {
    assert.equal(parseSchedule(text)?.kind, kind, text);
  }
  assert.equal(parseSchedule('rate(2 hours)').intervalMs, 7_200_000);
});

for (const target of databaseTargets) {
  test(`${target.name}: a failed job waits longer with each try, then gives up and keeps its error`, async () => {
    const db = await queue(target);
    const start = new Date('2026-01-01T00:00:00.000Z');
    await insertJob(db, 'send', { id: 1 }, { maxAttempts: 3 }, start);

    const expectations = [
      ['retry', 30_000],
      ['retry', 60_000],
      ['failed', undefined],
    ];
    let now = start;
    for (const [outcome, wait] of expectations) {
      const job = await claimJob(db, now);
      assert.ok(job, `a job is due at ${now.toISOString()}`);
      assert.deepEqual(job.payload, { id: 1 });
      assert.equal(await failJob(db, job, new Error(`try ${job.attempts}`), now), outcome);
      const [record] = await listJobRecords(db);
      assert.match(record.lastError, new RegExp(`try ${job.attempts}`));
      if (wait) {
        assert.equal(record.runAt, new Date(now.getTime() + wait).toISOString());
        assert.equal(await claimJob(db, new Date(now.getTime() + wait - 1)), undefined);
        now = new Date(now.getTime() + wait);
      } else {
        assert.equal(record.status, 'failed');
        assert.equal(record.attempts, 3);
      }
    }
    await db.close();
  });

  test(`${target.name}: jobs a stopped process was running go back in the queue`, async () => {
    const db = await queue(target);
    await insertJob(db, 'send', undefined);
    assert.ok(await claimJob(db));
    assert.equal(await claimJob(db), undefined);
    await tidyJobs(db);
    assert.equal((await claimJob(db))?.attempts, 2);
    await db.close();
  });

  test(`${target.name}: the worker runs queued jobs as they come due, and a failure does not stop it`, async () => {
    const db = await queue(target);
    const ran = [];
    const worker = startWorker({
      db,
      logger: quiet,
      pollMs: 10,
      run: async (name, payload, context) => {
        ran.push([name, payload, context.attempt]);
        if (name === 'bad') throw new Error('bad job');
      },
    });
    await insertJob(db, 'bad', undefined, { maxAttempts: 1 });
    await insertJob(db, 'good', { n: 1 });
    worker.wake();
    for (let waited = 0; ran.length < 2 && waited < 2000; waited += 20) await Bun.sleep(20);
    await worker.stop();
    assert.deepEqual(ran, [
      ['bad', undefined, 1],
      ['good', { n: 1 }, 1],
    ]);
    const byName = Object.fromEntries(
      (await listJobRecords(db)).map((job) => [job.name, job.status]),
    );
    assert.deepEqual(byName, { bad: 'failed', good: 'done' });
    await db.close();
  });
}

test('a scheduled job still running when its next run is due is skipped, not overlapped', async () => {
  const warnings = [];
  let runs = 0;
  let release;
  const scheduler = startScheduler({
    jobs: [{ name: 'slow', schedule: 'rate(1 second)' }],
    logger: { ...quiet, warn: (message) => warnings.push(message) },
    run: async () => {
      runs += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await Bun.sleep(2300);
  scheduler.stop();
  release?.();
  assert.equal(runs, 1);
  assert.ok(
    warnings.some((message) => message.includes('slow is still running')),
    warnings.join('\n'),
  );
});

test('a job queued inside a transaction runs only once the transaction commits', async () => {
  const { prepareApp } = await import('../dist/index.js');
  const { closeAppDatabase, db } = await import('../dist/db/index.js');
  const { jobs, startJobs } = await import('../dist/jobs/index.js');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-jobs-tx-'));
  const job = path.join(root, 'build', 'backend', 'jobs', 'record', 'index.js');
  await fs.mkdir(path.dirname(job), { recursive: true });
  await fs.writeFile(
    job,
    'export async function run(payload) { (globalThis.__ran ??= []).push(payload.n); }\n',
  );
  prepareApp(root);
  globalThis.__ran = [];
  const running = startJobs(quiet);
  try {
    // The first use of the queue, in a transaction that rolls back: its tables must outlast it.
    await assert.rejects(
      db.transaction(async () => {
        await jobs.enqueue('record', { n: 1 });
        await Bun.sleep(100);
        throw new Error('undo');
      }),
      /undo/,
    );
    await db.transaction(async () => {
      await jobs.enqueue('record', { n: 2 });
    });
    for (let waited = 0; globalThis.__ran.length === 0 && waited < 3000; waited += 20)
      await Bun.sleep(20);
    await Bun.sleep(100);
    assert.deepEqual(globalThis.__ran, [2]);
  } finally {
    await running.stop();
    await closeAppDatabase();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('a stopping scheduler starts no more runs, and waits for the one under way', async () => {
  let finished = false;
  let runs = 0;
  const scheduler = startScheduler({
    jobs: [
      { name: 'at-start', schedule: '@reboot' },
      { name: 'often', schedule: 'rate(1 second)' },
    ],
    logger: quiet,
    run: async (name) => {
      runs += 1;
      if (name !== 'at-start') return;
      await Bun.sleep(400);
      finished = true;
    },
  });
  await Bun.sleep(50);
  const started = Date.now();
  await scheduler.stop();
  assert.equal(finished, true, 'the run under way finished first');
  assert.ok(Date.now() - started >= 250);
  const after = runs;
  await Bun.sleep(1300);
  assert.equal(runs, after, 'nothing runs once stopped');
  // A run that fails is over too.
  const failing = startScheduler({
    jobs: [{ name: 'at-start', schedule: '@reboot' }],
    logger: quiet,
    run: async () => {
      throw new Error('broken on purpose');
    },
  });
  await failing.stop();
});
