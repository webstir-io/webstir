import { expect, test } from 'bun:test';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runCliInCopiedWorkspace(
  command: string,
  fixtureName: string,
  envOverrides: Record<string, string | undefined> = {}
) {
  const copiedWorkspace = await copyDemoWorkspace(fixtureName, `webstir-${fixtureName.replace(/[\\/]/g, '-')}-`);
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      command,
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ],
    cwd: repoRoot,
    env: {
      ...process.env,
      ...envOverrides,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    copiedWorkspace: copiedWorkspace.workspaceRoot,
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

test('CLI builds the spa demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('build', 'spa');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] build complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'build', 'frontend', 'pages', 'home', 'index.js'))).toBe(true);
});

test('CLI publishes the spa demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'spa');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages', 'home'))).toBe(true);
});

test('CLI publishes the api demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'api', {
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'build', 'backend', 'index.js'))).toBe(true);
});

test('CLI publishes the auth-crud demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'auth-crud', {
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'build', 'backend', 'index.js'))).toBe(true);
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages', 'home', 'index.html'))).toBe(true);
});

test('CLI publishes the dashboard demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'dashboard', {
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'build', 'backend', 'index.js'))).toBe(true);
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages', 'home', 'index.html'))).toBe(true);
});

test('CLI publishes the ssg demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'ssg/base');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'index.html'))).toBe(true);
});
