import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runCli(
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {},
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

async function createFreshWorkspace(mode: 'api' | 'full'): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-doctor-'));
  const workspaceRoot = path.join(tempRoot, mode);
  const initResult = await runCli(['init', mode, workspaceRoot]);
  expect(initResult.exitCode).toBe(0);
  return workspaceRoot;
}

test('CLI doctor reports scaffold drift and suggests repair', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-doctor-spa-', {
    workspaceName: 'spa',
  });

  try {
    const missingFile = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
    await rm(missingFile, { force: true });

    const result = await runCli(['doctor', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] doctor complete');
    expect(result.stdout).toContain('healthy: false');
    expect(result.stdout).toContain('scaffold: fail');
    expect(result.stdout).toContain('scaffold_drift');
    expect(result.stdout).toContain('Errors.404.html');
    expect(result.stdout).toContain(
      `repair: webstir repair --workspace ${copiedWorkspace.workspaceRoot}`,
    );
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI doctor emits machine-readable JSON for a healthy API workspace', async () => {
  const workspaceRoot = await createFreshWorkspace('api');

  try {
    const result = await runCli(['doctor', '--json', '--workspace', workspaceRoot], {
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');

    const parsed = JSON.parse(result.stdout) as {
      command: string;
      healthy: boolean;
      checks: Array<{ id: string; status: string }>;
      backend?: {
        routes: number;
        jobs: number;
        module: string;
        data: {
          migrations: {
            runnerPresent: boolean;
            migrationFilesCount: number;
            tableEnvKey: string;
            configuredTable: string;
          };
        };
      };
    };

    expect(parsed.command).toBe('doctor');
    expect(parsed.healthy).toBe(true);
    expect(parsed.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'scaffold', status: 'pass' }),
        expect.objectContaining({ id: 'backend-inspect', status: 'pass' }),
      ]),
    );
    expect(parsed.backend?.module).toBe('api@1.0.0');
    expect(typeof parsed.backend?.routes).toBe('number');
    expect(typeof parsed.backend?.jobs).toBe('number');
    expect(parsed.backend?.data.migrations.runnerPresent).toBe(false);
    expect(parsed.backend?.data.migrations.migrationFilesCount).toBe(0);
    expect(parsed.backend?.data.migrations.tableEnvKey).toBe('DATABASE_MIGRATIONS_TABLE');
    expect(parsed.backend?.data.migrations.configuredTable).toBe('_webstir_migrations');
  } finally {
    await rm(path.dirname(workspaceRoot), { recursive: true, force: true });
  }
});

test('CLI doctor reports backend inspect failures for backend-capable workspaces', async () => {
  const workspaceRoot = await createFreshWorkspace('api');

  try {
    const backendEntry = path.join(workspaceRoot, 'src', 'backend', 'index.ts');
    await writeFile(backendEntry, 'export default (\n', 'utf8');

    const result = await runCli(['doctor', '--json', '--workspace', workspaceRoot], {
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');

    const parsed = JSON.parse(result.stdout) as {
      command: string;
      healthy: boolean;
      checks: Array<{ id: string; status: string; detail?: string }>;
      issues: Array<{ code: string; message: string }>;
    };

    expect(parsed.command).toBe('doctor');
    expect(parsed.healthy).toBe(false);
    expect(parsed.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'backend-inspect', status: 'fail' })]),
    );
    expect(parsed.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'backend_inspect_failed' })]),
    );
  } finally {
    await rm(path.dirname(workspaceRoot), { recursive: true, force: true });
  }
});
