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
  const workspace = await mkdtemp(path.join(os.tmpdir(), `webstir-test-${tempPrefix}-`));
  const copiedWorkspace = path.join(workspace, fixtureName);
  await cp(fixtureRoot, copiedWorkspace, { recursive: true });
  return copiedWorkspace;
}

async function runCli(
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {}
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

test('CLI test runs the SPA demo frontend suite end to end', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('spa');

  try {
    const result = await runCli(['test', '--workspace', copiedWorkspace]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] test complete');
    expect(result.stdout).toContain('mode: spa');
    expect(result.stdout).toContain('runtime: all');
    expect(result.stdout).toContain('build-targets: frontend');
    expect(result.stdout).toContain('tests: 1');
    expect(result.stdout).toContain('passed: 1');
    expect(result.stdout).toContain('failed: 0');
  } finally {
    await rm(path.dirname(copiedWorkspace), { recursive: true, force: true });
  }
});

test('CLI test honors --runtime backend for full workspaces', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('full');

  try {
    const addTestResult = await runCli(['add-test', 'backend/ping', '--workspace', copiedWorkspace]);
    expect(addTestResult.exitCode).toBe(0);

    const result = await runCli(
      ['test', '--runtime', 'backend', '--workspace', copiedWorkspace],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] test complete');
    expect(result.stdout).toContain('mode: full');
    expect(result.stdout).toContain('runtime: backend');
    expect(result.stdout).toContain('build-targets: backend');
    expect(result.stdout).toContain("filter: Runtime filter 'backend' matched 1 test (1 skipped).");
    expect(result.stdout).toContain('tests: 1');
    expect(result.stdout).toContain('passed: 1');
    expect(result.stdout).toContain('failed: 0');
  } finally {
    await rm(path.dirname(copiedWorkspace), { recursive: true, force: true });
  }
});
