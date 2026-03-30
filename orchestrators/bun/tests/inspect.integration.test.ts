import { expect, test } from 'bun:test';
import path from 'node:path';
import { rm } from 'node:fs/promises';

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

test('CLI inspect composes doctor and frontend inspection for a spa workspace', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-inspect-spa-');

  try {
    const result = await runCli([
      'inspect',
      '--json',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');

    const parsed = JSON.parse(result.stdout) as {
      command: string;
      success: boolean;
      steps: Array<{ id: string; status: string }>;
      frontend?: { pages: Array<{ name: string }> };
      backend?: unknown;
    };

    expect(parsed.command).toBe('inspect');
    expect(parsed.success).toBe(true);
    expect(parsed.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doctor', status: 'completed' }),
        expect.objectContaining({ id: 'frontend-inspect', status: 'completed' }),
        expect.objectContaining({ id: 'backend-inspect', status: 'skipped' }),
      ]),
    );
    expect(parsed.frontend?.pages).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'home' })]),
    );
    expect(parsed.backend).toBeUndefined();
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI inspect still returns backend details when diagnosis fails', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-inspect-api-');

  try {
    await rm(path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html'), { force: true });

    const result = await runCli(
      ['inspect', '--json', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');

    const parsed = JSON.parse(result.stdout) as {
      success: boolean;
      doctor: { healthy: boolean };
      steps: Array<{ id: string; status: string }>;
      backend?: { manifest: { name: string } };
      frontend?: unknown;
    };

    expect(parsed.success).toBe(false);
    expect(parsed.doctor.healthy).toBe(false);
    expect(parsed.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doctor', status: 'failed' }),
        expect.objectContaining({ id: 'frontend-inspect', status: 'skipped' }),
        expect.objectContaining({ id: 'backend-inspect', status: 'completed' }),
      ]),
    );
    expect(parsed.backend?.manifest.name).toBe('webstir-demo-api');
    expect(parsed.frontend).toBeUndefined();
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
