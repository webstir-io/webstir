import { expect, test } from 'bun:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
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
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-backend-add-api-');

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
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] add-route complete');
    expect(result.stdout).toContain('target: POST /api/accounts');

    const packageJson = await readJson(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
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
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI add-job scaffolds a backend job end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-backend-add-api-');

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
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] add-job complete');
    expect(existsSync(path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'jobs', 'nightly', 'index.ts'))).toBe(true);

    const packageJson = await readJson(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
    expect(packageJson.webstir.moduleManifest.jobs).toEqual([
      {
        name: 'nightly',
        schedule: '0 0 * * *',
        description: 'Nightly maintenance run',
        priority: 5,
      },
    ]);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
