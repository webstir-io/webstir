import { expect, test } from 'bun:test';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import { runWebstir } from '../test-support/cli.ts';

async function runCli(args: readonly string[]): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const processResult = await runWebstir(args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
    },
  });

  return {
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    exitCode: processResult.exitCode ?? -1,
  };
}

test('CLI smoke runs the full demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-smoke-full-');

  try {
    const result = await runCli(['smoke', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir-backend] build:start');
    expect(result.stdout).toContain('[webstir] smoke complete');
    expect(result.stdout).toContain('layers: pages + server');
    expect(result.stdout).toContain('workspace-source: explicit workspace');
    expect(result.stdout).toContain('phases: 5');
    expect(result.stdout).toContain('  - build: frontend:');
    expect(result.stdout).toMatch(/ {2}- test: \d+ passed, 0 failed/);
    expect(result.stdout).toContain('  - publish: frontend:');
    expect(result.stdout).toContain('  - doctor: healthy');
    expect(result.stdout).toMatch(/ {2}- backend-inspect: \d+ routes, 0 jobs/);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI smoke defaults to a temporary full workspace built from Bun-owned templates', async () => {
  const result = await runCli(['smoke']);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('[webstir-backend] build:start');
  expect(result.stdout).toContain('[webstir] smoke complete');
  expect(result.stdout).toContain('layers: pages + server');
  expect(result.stdout).toContain('workspace-source: temporary copy');
  expect(result.stdout).toContain('source: built-in full template');
  expect(result.stdout).toContain('phases: 5');
  expect(result.stdout).toContain('  - build: frontend:');
  expect(result.stdout).toMatch(/ {2}- test: \d+ passed, 0 failed/);
  expect(result.stdout).toContain('  - publish: frontend:');
  expect(result.stdout).toContain('  - doctor: healthy');
  expect(result.stdout).toMatch(/ {2}- backend-inspect: \d+ routes, 0 jobs/);
});
