import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatesRoot = path.join(packageRoot, 'templates', 'backend', 'jobs');

async function createWorkspace(prefix = 'webstir-backend-jobs-') {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(workspace, 'src', 'backend', 'jobs'), { recursive: true });
  await fs.copyFile(
    path.join(packageRoot, 'templates', 'backend', 'env.ts'),
    path.join(workspace, 'src', 'backend', 'env.ts'),
  );
  await fs.copyFile(
    path.join(templatesRoot, 'runtime.ts'),
    path.join(workspace, 'src', 'backend', 'jobs', 'runtime.ts'),
  );
  await fs.copyFile(
    path.join(templatesRoot, 'scheduler.ts'),
    path.join(workspace, 'src', 'backend', 'jobs', 'scheduler.ts'),
  );
  return workspace;
}

async function writePackage(workspace, jobs) {
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ type: 'module', webstir: { moduleManifest: { jobs } } }, null, 2),
    'utf8',
  );
}

async function writeJob(workspace, name, source) {
  const dir = path.join(workspace, 'src', 'backend', 'jobs', name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.ts'), source, 'utf8');
}

function runScheduler(workspace, args, options = {}) {
  return collectProcess(startScheduler(workspace, args, options), options);
}

function startScheduler(workspace, args, options = {}) {
  const child = spawn('bun', [path.join('src', 'backend', 'jobs', 'scheduler.ts'), ...args], {
    cwd: workspace,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

function collectProcess(child, options = {}) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  let timeout;
  return new Promise((resolve, reject) => {
    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`scheduler timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, options.timeoutMs);
    }

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test('jobs scheduler lists stable text and JSON metadata', async () => {
  const workspace = await createWorkspace();
  try {
    await writePackage(workspace, [
      {
        name: 'nightly',
        schedule: 'rate(5 minutes)',
        description: 'Refresh snapshots',
        priority: 10,
      },
    ]);
    await writeJob(workspace, 'nightly', 'export async function run() {}\n');

    const listed = await runScheduler(workspace, ['--list']);
    assert.equal(listed.code, 0);
    assert.match(listed.stdout, /- nightly \(rate\(5 minutes\)\).*Refresh snapshots/);

    const json = await runScheduler(workspace, ['--json']);
    assert.equal(json.code, 0);
    assert.deepEqual(JSON.parse(json.stdout), [
      {
        name: 'nightly',
        schedule: 'rate(5 minutes)',
        description: 'Refresh snapshots',
        priority: 10,
      },
    ]);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('jobs scheduler runs named jobs and reports missing jobs clearly', async () => {
  const workspace = await createWorkspace();
  try {
    await writePackage(workspace, [{ name: 'existing' }]);
    await writeJob(
      workspace,
      'existing',
      'export async function run() { console.log("ran job"); }\n',
    );

    const existing = await runScheduler(workspace, ['--job', 'existing']);
    assert.equal(existing.code, 0);
    assert.match(existing.stdout, /ran job/);
    assert.match(existing.stdout, /\[jobs\] existing completed/);

    const missing = await runScheduler(workspace, ['--job', 'missing']);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /\[jobs\] job 'missing' not found/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('jobs scheduler reports missing modules, missing run exports, and thrown errors', async () => {
  const workspace = await createWorkspace();
  try {
    await writePackage(workspace, [
      { name: 'missing-module' },
      { name: 'missing-run' },
      { name: 'throws' },
    ]);
    await writeJob(workspace, 'missing-run', 'export const value = 1;\n');
    await writeJob(
      workspace,
      'throws',
      'export async function run() { throw new Error("database unavailable"); }\n',
    );

    const missingModule = await runScheduler(workspace, ['--job', 'missing-module']);
    assert.equal(missingModule.code, 1);
    assert.match(missingModule.stderr, /missing-module failed/);
    assert.match(missingModule.stderr, /unable to load job 'missing-module'/);

    const missingRun = await runScheduler(workspace, ['--job', 'missing-run']);
    assert.equal(missingRun.code, 1);
    assert.match(missingRun.stderr, /job module must export a run\(\) or default function/);

    const throws = await runScheduler(workspace, ['--job', 'throws']);
    assert.equal(throws.code, 1);
    assert.match(throws.stderr, /throws failed: database unavailable/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('jobs scheduler supports @reboot, rate schedules, cron schedules, and unsupported diagnostics', {
  timeout: 10_000,
}, async () => {
  const workspace = await createWorkspace();
  try {
    await writePackage(workspace, [
      { name: 'boot', schedule: '@reboot' },
      { name: 'fast', schedule: 'rate(1 second)' },
      { name: 'cron', schedule: '* * * * *' },
      { name: 'bad', schedule: 'every Tuesdayish' },
    ]);
    await writeJob(workspace, 'boot', 'export async function run() { console.log("booted"); }\n');
    await writeJob(workspace, 'fast', 'export async function run() { console.log("fast"); }\n');
    await writeJob(workspace, 'cron', 'export async function run() { console.log("cron"); }\n');
    await writeJob(workspace, 'bad', 'export async function run() { console.log("bad"); }\n');

    const reboot = await runScheduler(workspace, ['--watch', '--job', 'boot']);
    assert.equal(reboot.code, 0);
    assert.match(reboot.stdout, /booted/);
    assert.match(reboot.stdout, /completed @reboot jobs and exiting/);

    const unsupported = await runScheduler(workspace, ['--watch', '--job', 'bad']);
    assert.equal(unsupported.code, 0);
    assert.match(unsupported.stdout, /unsupported schedule 'every Tuesdayish'/);

    const rate = startScheduler(workspace, ['--watch', '--job', 'fast']);
    const rateResultPromise = collectProcess(rate, { timeoutMs: 4000 });
    await wait(1500);
    rate.kill('SIGTERM');
    const rateResult = await rateResultPromise;
    assert.equal(rateResult.code, 0);
    assert.match(rateResult.stdout, /watching jobs: fast/);
    assert.match(rateResult.stdout, /fast/);
    assert.match(rateResult.stdout, /received SIGTERM; stopped 1 scheduled job timer/);

    const cron = startScheduler(workspace, ['--watch', '--job', 'cron']);
    const cronResultPromise = collectProcess(cron, { timeoutMs: 4000 });
    await wait(300);
    cron.kill('SIGTERM');
    const cronResult = await cronResultPromise;
    assert.equal(cronResult.code, 0);
    assert.match(cronResult.stdout, /watching jobs: cron/);
    assert.match(cronResult.stdout, /received SIGTERM; stopped 1 scheduled job timer/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('jobs scheduler skips overlapping rate runs', { timeout: 10_000 }, async () => {
  const workspace = await createWorkspace();
  try {
    await writePackage(workspace, [{ name: 'slow', schedule: 'rate(1 second)' }]);
    await writeJob(
      workspace,
      'slow',
      [
        'const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));',
        'export async function run() {',
        '  console.log("slow-start");',
        '  await sleep(1400);',
        '  console.log("slow-end");',
        '}',
      ].join('\n'),
    );

    const child = startScheduler(workspace, ['--watch', '--job', 'slow']);
    const resultPromise = collectProcess(child, { timeoutMs: 6000 });
    await wait(2300);
    child.kill('SIGTERM');
    const result = await resultPromise;
    assert.equal(result.code, 0);
    assert.match(result.stdout, /slow-start/);
    assert.match(result.stderr, /skipping slow; previous run is still active/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

async function wait(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
