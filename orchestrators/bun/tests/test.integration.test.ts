import { expect, test } from 'bun:test';
import path from 'node:path';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
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

test('CLI test runs the full demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-test-full-');

  try {
    const result = await runCli(
      ['test', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] test complete');
    expect(result.stdout).toContain('mode: full');
    expect(result.stdout).toContain('runtime: all');
    expect(result.stdout).toContain('build-targets: frontend, backend');
    expect(result.stdout).toMatch(/tests: \d+/);
    expect(result.stdout).toMatch(/passed: \d+/);
    expect(result.stdout).toContain('failed: 0');
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
    const addTestResult = await runCli(['add-test', 'backend/ping', '--workspace', copiedWorkspace.workspaceRoot]);
    expect(addTestResult.exitCode).toBe(0);

    const result = await runCli(
      ['test', '--runtime', 'backend', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] test complete');
    expect(result.stdout).toContain('mode: full');
    expect(result.stdout).toContain('runtime: backend');
    expect(result.stdout).toContain('build-targets: backend');
    expect(result.stdout).toMatch(/filter: Runtime filter 'backend' matched \d+ tests \(1 skipped\)\./);
    expect(result.stdout).toMatch(/tests: \d+/);
    expect(result.stdout).toMatch(/passed: \d+/);
    expect(result.stdout).toContain('failed: 0');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
