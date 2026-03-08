import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function copyFixtureWorkspace(fixtureName: string): Promise<string> {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', fixtureName);
  const tempPrefix = fixtureName.replace(/[\\/]/g, '-');
  const workspace = await mkdtemp(path.join(os.tmpdir(), `webstir-bun-backend-add-${tempPrefix}-`));
  const copiedWorkspace = path.join(workspace, fixtureName);
  await cp(fixtureRoot, copiedWorkspace, { recursive: true });
  return copiedWorkspace;
}

async function runCli(args: readonly string[]): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const processResult = Bun.spawnSync({
    cmd: [process.execPath, path.join(packageRoot, 'src', 'cli.ts'), ...args],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

test('CLI add-route writes backend route manifest metadata end to end', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('api');

  try {
    const result = await runCli([
      'add-route',
      'accounts',
      '--method',
      'POST',
      '--path',
      '/api/accounts',
      '--summary',
      'List accounts',
      '--description',
      'Returns the current account list',
      '--tags',
      'accounts,api,accounts',
      '--params-schema',
      'zod:AccountParams@src/shared/contracts/accounts.ts',
      '--response-schema',
      'AccountList@src/shared/contracts/accounts.ts',
      '--response-status',
      '201',
      '--workspace',
      copiedWorkspace,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir-bun] add-route complete');
    expect(result.stdout).toContain('target: POST /api/accounts');

    const packageJson = await readJson(path.join(copiedWorkspace, 'package.json'));
    expect(packageJson.webstir.moduleManifest.routes).toEqual([
      {
        name: 'accounts',
        method: 'POST',
        path: '/api/accounts',
        summary: 'List accounts',
        description: 'Returns the current account list',
        tags: ['accounts', 'api'],
        input: {
          params: {
            kind: 'zod',
            name: 'AccountParams',
            source: 'src/shared/contracts/accounts.ts',
          },
        },
        output: {
          body: {
            kind: 'zod',
            name: 'AccountList',
            source: 'src/shared/contracts/accounts.ts',
          },
          status: 201,
        },
      },
    ]);
  } finally {
    await rm(path.dirname(copiedWorkspace), { recursive: true, force: true });
  }
});

test('CLI add-job scaffolds a backend job end to end', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('api');

  try {
    const result = await runCli([
      'add-job',
      'nightly',
      '--schedule',
      '0 0 * * *',
      '--description',
      'Nightly maintenance run',
      '--priority',
      '5',
      '--workspace',
      copiedWorkspace,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir-bun] add-job complete');
    expect(existsSync(path.join(copiedWorkspace, 'src', 'backend', 'jobs', 'nightly', 'index.ts'))).toBe(true);

    const packageJson = await readJson(path.join(copiedWorkspace, 'package.json'));
    expect(packageJson.webstir.moduleManifest.jobs).toEqual([
      {
        name: 'nightly',
        schedule: '0 0 * * *',
        description: 'Nightly maintenance run',
        priority: 5,
      },
    ]);
  } finally {
    await rm(path.dirname(copiedWorkspace), { recursive: true, force: true });
  }
});
