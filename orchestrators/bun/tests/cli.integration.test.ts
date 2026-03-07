import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

test('CLI builds the spa demo workspace end to end', async () => {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', 'spa');
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-bun-spa-'));
  const copiedWorkspace = path.join(workspace, 'spa');

  await cp(fixtureRoot, copiedWorkspace, { recursive: true });

  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'build',
      '--workspace',
      copiedWorkspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = decodeOutput(processResult.stdout);
  const stderr = decodeOutput(processResult.stderr);

  expect(processResult.exitCode).toBe(0);
  expect(stderr).toBe('');
  expect(stdout).toContain('[webstir-bun] build complete');
  expect(existsSync(path.join(copiedWorkspace, 'build', 'frontend', 'pages', 'home', 'index.js'))).toBe(true);
});
