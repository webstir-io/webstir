import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runCliInCopiedWorkspace(
  command: string,
  fixtureName: string,
  envOverrides: Record<string, string | undefined> = {}
) {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', fixtureName);
  const tempPrefix = fixtureName.replace(/[\\/]/g, '-');
  const workspace = await mkdtemp(path.join(os.tmpdir(), `webstir-bun-${tempPrefix}-`));
  const copiedWorkspace = path.join(workspace, fixtureName);
  await cp(fixtureRoot, copiedWorkspace, { recursive: true });
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      command,
      '--workspace',
      copiedWorkspace,
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
    copiedWorkspace,
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

test('CLI builds the spa demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('build', 'spa');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir-bun] build complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'build', 'frontend', 'pages', 'home', 'index.js'))).toBe(true);
});

test('CLI publishes the spa demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'spa');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir-bun] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages', 'home'))).toBe(true);
});

test('CLI publishes the api demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'api', {
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir-bun] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'build', 'backend', 'index.js'))).toBe(true);
});

test('CLI publishes the ssg demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'ssg/base');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir-bun] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'index.html'))).toBe(true);
});
