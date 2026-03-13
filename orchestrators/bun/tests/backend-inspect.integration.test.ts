import { expect, test } from 'bun:test';
import path from 'node:path';

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
  return await runCliWithEnv(args, {});
}

async function runCliWithEnv(
  args: readonly string[],
  envOverrides: Record<string, string | undefined>
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

test('CLI backend-inspect reports routes and jobs for an API workspace', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-backend-inspect-api-');

  try {
    const addRoute = await runCli([
      'add-route',
      'accounts',
      '--method',
      'GET',
      '--path',
      '/api/accounts',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);
    expect(addRoute.exitCode).toBe(0);

    const addJob = await runCli([
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
    expect(addJob.exitCode).toBe(0);

    const inspectResult = await runCliWithEnv(
      [
        'backend-inspect',
        '--workspace',
        copiedWorkspace.workspaceRoot,
      ],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' }
    );

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stderr).toBe('');
    expect(inspectResult.stdout).toContain('[webstir] backend-inspect complete');
    expect(inspectResult.stdout).toContain('mode: api');
    expect(inspectResult.stdout).toContain('module: webstir-demo-api@1.0.0');
    expect(inspectResult.stdout).toContain('routes: 1');
    expect(inspectResult.stdout).toContain('GET /api/accounts (accounts)');
    expect(inspectResult.stdout).toContain('jobs: 1');
    expect(inspectResult.stdout).toContain('nightly (schedule: 0 0 * * *, description: Nightly maintenance run, priority: 5)');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI backend-inspect rejects frontend-only workspaces', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-backend-inspect-spa-');

  try {
    const inspectResult = await runCli([
      'backend-inspect',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(inspectResult.exitCode).toBe(1);
    expect(inspectResult.stderr).toContain('backend-inspect only supports api and full workspaces');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
