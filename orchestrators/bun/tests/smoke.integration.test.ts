import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, rm } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function copyFixtureWorkspace(fixtureName: string): Promise<string> {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', fixtureName);
  const tempPrefix = fixtureName.replace(/[\\/]/g, '-');
  const workspace = await mkdtemp(path.join(os.tmpdir(), `webstir-smoke-${tempPrefix}-`));
  const copiedWorkspace = path.join(workspace, fixtureName);
  await cp(fixtureRoot, copiedWorkspace, { recursive: true });
  return copiedWorkspace;
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
  const copiedWorkspace = await copyFixtureWorkspace('full');

  try {
    const result = runCli(['smoke', '--workspace', copiedWorkspace]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir-backend] build:start');
    expect(result.stdout).toContain('[webstir] smoke complete');
    expect(result.stdout).toContain('mode: full');
    expect(result.stdout).toContain('workspace-source: explicit workspace');
    expect(result.stdout).toContain('phases: 4');
    expect(result.stdout).toContain('  - build: frontend:');
    expect(result.stdout).toMatch(/  - test: \d+ passed, 0 failed/);
    expect(result.stdout).toContain('  - publish: frontend:');
    expect(result.stdout).toMatch(/  - backend-inspect: \d+ routes, 0 jobs/);
  } finally {
    await rm(path.dirname(copiedWorkspace), { recursive: true, force: true });
  }
});

test('CLI smoke defaults to a temporary copy of the full demo', () => {
  const result = runCli(['smoke']);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('[webstir] smoke complete');
  expect(result.stdout).toContain('mode: full');
  expect(result.stdout).toContain('workspace-source: temporary copy');
  expect(result.stdout).toContain(`source: ${path.join(repoRoot, 'examples', 'demos', 'full')}`);
});
