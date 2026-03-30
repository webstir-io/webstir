import { expect, test } from 'bun:test';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

function runCli(args: readonly string[]): {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
} {
  const processResult = Bun.spawnSync({
    cmd: [process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
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

test('CLI smoke runs the full demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-smoke-full-');

  try {
    const result = runCli(['smoke', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir-backend] build:start');
    expect(result.stdout).toContain('[webstir] smoke complete');
    expect(result.stdout).toContain('mode: full');
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

test('CLI smoke defaults to a temporary full workspace built from Bun-owned templates', () => {
  const result = runCli(['smoke']);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('[webstir-backend] build:start');
  expect(result.stdout).toContain('[webstir] smoke complete');
  expect(result.stdout).toContain('mode: full');
  expect(result.stdout).toContain('workspace-source: temporary copy');
  expect(result.stdout).toContain('source: built-in full template');
  expect(result.stdout).toContain('phases: 5');
  expect(result.stdout).toContain('  - build: frontend:');
  expect(result.stdout).toMatch(/ {2}- test: \d+ passed, 0 failed/);
  expect(result.stdout).toContain('  - publish: frontend:');
  expect(result.stdout).toContain('  - doctor: healthy');
  expect(result.stdout).toMatch(/ {2}- backend-inspect: \d+ routes, 0 jobs/);
});
