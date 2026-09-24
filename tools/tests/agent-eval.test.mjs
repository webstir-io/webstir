import { test, expect } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execute, score, summarize } from '../agent-eval/process.mjs';
import { ACCEPTANCE, TASKS, taskPrompt } from '../agent-eval/tasks.mjs';

test('an agent success message cannot override missing or failed independent acceptance', () => {
  const agent = { code: 0, elapsedMs: 30, timedOut: false, tail: 'All done, checks passed.' };
  const expected = ACCEPTANCE.repair;
  const checks = expected.map((name) => ({ name, passed: true }));
  expect(score({ agent, expected, checks })).toBe('passed');
  expect(score({ agent, expected, checks: checks.slice(1) })).toBe('task_failure');
  expect(
    score({
      agent,
      expected,
      checks: checks.map((check) => ({ ...check, passed: check.name !== 'authorization' })),
    }),
  ).toBe('task_failure');
  expect(score({ agent, expected: [], checks: [] })).toBe('task_failure');
  expect(
    score({ agent, expected, checks: [...checks, { name: 'application-runtime', passed: false }] }),
  ).toBe('task_failure');
  expect(
    score({ agent, expected, checks: [...checks, { name: 'authorization', passed: false }] }),
  ).toBe('task_failure');
});

test('timeouts and agent/environment failures cannot be counted as successful tasks', () => {
  const expected = ['browser-crud'];
  const checks = [{ name: 'browser-crud', passed: true }];
  expect(score({ expected, checks, agent: { code: 0, timedOut: true } })).toBe('timeout');
  expect(score({ expected, checks, agent: { code: 1 } })).toBe('agent_error');
  expect(score({ expected, checks, setupError: 'registry offline' })).toBe('environment_error');
  expect(
    score({ expected, checks, agent: { code: 0 }, evaluatorError: 'browser binary unavailable' }),
  ).toBe('environment_error');
});

test('summary retains failed and environment runs in the denominator, with timings only for correct results', () => {
  const records = ['passed', 'task_failure', 'timeout', 'environment_error', 'agent_error'].map(
    (outcome, index) => ({
      outcome,
      agent: { elapsedMs: index + 10 },
      humanInterventions: index === 1 ? 2 : 0,
    }),
  );
  expect(summarize(records)).toEqual({
    runs: 5,
    counts: { passed: 1, task_failure: 1, timeout: 1, environment_error: 1, agent_error: 1 },
    completionRate: 0.2,
    correctElapsedMs: [10],
    humanInterventions: 2,
  });
});

test('runner terminates a hung process and retains its pre-timeout output', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webstir-eval-process-'));
  try {
    const log = path.join(directory, 'process.log');
    const result = await execute(
      'bun',
      ['-e', "console.log('started'); setInterval(() => {}, 1000)"],
      { timeoutMs: 100, log },
    );
    expect(result.timedOut).toBe(true);
    expect(result.elapsedMs).toBeLessThan(3000);
    expect(await readFile(log, 'utf8')).toContain('started');
    const absent = await execute('/not/a/real/executable', [], { timeoutMs: 100 });
    expect(absent.code).not.toBe(0);
    expect(absent.tail).toContain('ENOENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('frozen public task contracts disclose interfaces without evaluator source locations', () => {
  for (const task of TASKS) {
    const prompt = taskPrompt(task, '/consumer/node_modules/webstir/src/cli.ts');
    expect(prompt).toContain('/api/notes');
    expect(prompt).toContain('DATA_DIR');
    expect(prompt).toContain('JavaScript disabled');
    expect(prompt).not.toContain('tools/agent-eval');
  }
  expect(() => taskPrompt('missing', 'webstir')).toThrow();
});

test('repeating a run refuses before campaign or recorded evidence can be changed', async () => {
  const { mkdir, writeFile, access } = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webstir-eval-evidence-'));
  const runner = new URL('../agent-eval/run.mjs', import.meta.url).pathname;
  try {
    for (const mode of ['run', 'prepare', 'self-check', 'grade']) {
      const campaign = path.join(directory, mode);
      const evidence = path.join(campaign, 'repair-1/evidence');
      await mkdir(evidence, { recursive: true });
      const result = path.join(evidence, 'result.json');
      const original = '{"outcome":"passed","evidence":"original"}\n';
      await writeFile(result, original);
      const refused = await execute(
        'bun',
        [
          runner,
          '--package',
          '/missing/package.tgz',
          '--output',
          directory,
          '--label',
          mode,
          '--mode',
          mode,
          '--task',
          'repair',
          '--repeats',
          '1',
        ],
        { timeoutMs: 10000 },
      );
      expect(refused.code).not.toBe(0);
      expect(refused.tail).toContain('Refusing to overwrite existing trial evidence');
      expect(await readFile(result, 'utf8')).toBe(original);
      await expect(access(path.join(campaign, 'settings.json'))).rejects.toThrow();
      await expect(access(path.join(campaign, 'installed'))).rejects.toThrow();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('installed versions follow CLI resolution for bundled and hoisted package layouts', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { installedVersions } = await import('../agent-eval/setup.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webstir-eval-layout-'));
  const names = [
    'webstir',
    'webstir-backend',
    'webstir-frontend',
    'webstir-testing',
    'module-contract',
    'testing-contract',
  ];
  async function manifest(root, name, version) {
    const location = path.join(root, 'node_modules/@webstir-io', name);
    await mkdir(location, { recursive: true });
    await writeFile(
      path.join(location, 'package.json'),
      JSON.stringify({
        name: `@webstir-io/${name}`,
        version,
        exports: { './package.json': './package.json' },
      }),
    );
    return location;
  }
  try {
    const hoisted = path.join(directory, 'hoisted');
    const bundled = path.join(directory, 'bundled');
    for (const name of names) {
      await manifest(hoisted, name, '1.0.0');
      await manifest(bundled, name, '1.0.0');
    }
    expect((await installedVersions(hoisted))['@webstir-io/webstir-backend']).toBe('1.0.0');
    const cli = path.join(bundled, 'node_modules/@webstir-io/webstir');
    await manifest(cli, 'webstir-backend', '2.0.0');
    const nested = await installedVersions(bundled);
    expect(nested['@webstir-io/webstir-backend']).toBe('2.0.0');
    expect(nested['@webstir-io/webstir-frontend']).toBe('1.0.0');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('readiness rejects a server that accepts requests without responding', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { startApp } = await import('../agent-eval/grade.mjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webstir-eval-hung-'));
  try {
    await mkdir(path.join(directory, 'build/backend'), { recursive: true });
    await writeFile(
      path.join(directory, 'build/backend/index.js'),
      'Bun.serve({port:Number(process.env.PORT),fetch(){return new Promise(()=>{});}});',
    );
    const started = Date.now();
    await expect(
      startApp(directory, directory, undefined, { readinessTimeoutMs: 250 }),
    ).rejects.toThrow('App failed to start');
    expect(Date.now() - started).toBeLessThan(2000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('regrading rejects a symlink output alias into the original evidence tree', async () => {
  const { mkdir, symlink, access } = await import('node:fs/promises');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'webstir-eval-alias-'));
  try {
    const input = path.join(directory, 'original');
    await mkdir(input);
    await symlink(input, path.join(directory, 'alias'), 'dir');
    const result = await execute(
      'bun',
      [
        new URL('../agent-eval/regrade.mjs', import.meta.url).pathname,
        '--input',
        input,
        '--output',
        path.join(directory, 'alias/regraded'),
        '--expected-runs',
        '1',
      ],
      { timeoutMs: 10000 },
    );
    expect(result.code).not.toBe(0);
    expect(result.tail).toContain('outside the original campaign directory tree');
    await expect(access(path.join(input, 'regraded'))).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
