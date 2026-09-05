import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runCli(
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {},
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const processResult = Bun.spawnSync({
    cmd: [process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

function readSummaryCounts(stdout: string): { tests: number; passed: number; failed: number } {
  const read = (label: string): number => {
    const match = stdout.match(new RegExp(`^${label}: (\\d+)$`, 'm'));
    if (!match) {
      throw new Error(`Missing "${label}:" line in output:\n${stdout}`);
    }
    return Number(match[1]);
  };
  return { tests: read('tests'), passed: read('passed'), failed: read('failed') };
}

// The full demo ships one frontend test module and one backend test module (7 tests).
const FULL_DEMO_FRONTEND_TESTS = 1;
const FULL_DEMO_BACKEND_TESTS = 7;

test('CLI test runs the full demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-test-full-');

  try {
    const result = await runCli(['test', '--workspace', copiedWorkspace.workspaceRoot], {
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] test complete');
    expect(result.stdout).toContain('mode: full');
    expect(result.stdout).toContain('runtime: all');
    expect(result.stdout).toContain('build-targets: frontend, backend');
    expect(readSummaryCounts(result.stdout)).toEqual({
      tests: FULL_DEMO_FRONTEND_TESTS + FULL_DEMO_BACKEND_TESTS,
      passed: FULL_DEMO_FRONTEND_TESTS + FULL_DEMO_BACKEND_TESTS,
      failed: 0,
    });
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI test still supports frontend-only SPA workspaces', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-test-spa-');

  try {
    const result = await runCli(['test', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] test complete');
    expect(result.stdout).toContain('mode: spa');
    expect(result.stdout).toContain('runtime: all');
    expect(result.stdout).toContain('build-targets: frontend');
    expect(result.stdout).toContain('tests: 1');
    expect(result.stdout).toContain('passed: 1');
    expect(result.stdout).toContain('failed: 0');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI test honors --runtime backend for the full demo workspace', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-test-full-runtime-');

  try {
    const addTestResult = await runCli([
      'add-test',
      'backend/ping',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);
    expect(addTestResult.exitCode).toBe(0);

    const result = await runCli(
      ['test', '--runtime', 'backend', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] test complete');
    expect(result.stdout).toContain('mode: full');
    expect(result.stdout).toContain('runtime: backend');
    expect(result.stdout).toContain('build-targets: backend');
    expect(result.stdout).toContain(
      "filter: Runtime filter 'backend' matched 2 test modules (1 skipped).",
    );
    // The demo backend tests plus the single scaffolded ping test all execute.
    expect(readSummaryCounts(result.stdout)).toEqual({
      tests: FULL_DEMO_BACKEND_TESTS + 1,
      passed: FULL_DEMO_BACKEND_TESTS + 1,
      failed: 0,
    });
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI test executes backend tests and fails the run when one of them fails', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-test-full-backend-failure-');

  try {
    const testsDir = path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'tests');
    await mkdir(testsDir, { recursive: true });
    await writeFile(
      path.join(testsDir, 'deliberate-failure.test.ts'),
      `import { assert, test } from '@webstir-io/webstir-testing';

test('backend test that passes', () => {
  assert.equal(1, 1);
});

test('backend test that deliberately fails', () => {
  assert.equal('actual', 'expected');
});
`,
      'utf8',
    );

    const result = await runCli(
      ['test', '--runtime', 'backend', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(result.exitCode).not.toBe(0);
    expect(readSummaryCounts(result.stdout)).toEqual({
      tests: FULL_DEMO_BACKEND_TESTS + 2,
      passed: FULL_DEMO_BACKEND_TESTS + 1,
      failed: 1,
    });
    expect(result.stdout).toContain('backend test that deliberately fails');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
