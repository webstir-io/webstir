import { expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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

test('CLI agent validate orchestrates doctor and test for a healthy workspace', {
  timeout: 15_000,
}, async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-agent-validate-spa-');

  try {
    const result = await runCli([
      'agent',
      'validate',
      '--json',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout) as {
      command: string;
      goal: string;
      success: boolean;
      steps: Array<{ id: string; status: string }>;
      test?: { hadFailures: boolean };
    };

    expect(parsed.command).toBe('agent');
    expect(parsed.goal).toBe('validate');
    expect(parsed.success).toBe(true);
    expect(parsed.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doctor', status: 'completed' }),
        expect.objectContaining({ id: 'test', status: 'completed' }),
      ]),
    );
    expect(parsed.test?.hadFailures).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI agent repair restores scaffold drift and re-validates the workspace', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-agent-repair-spa-');

  try {
    const missingFile = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
    await rm(missingFile, { force: true });

    const result = await runCli([
      'agent',
      'repair',
      '--json',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(existsSync(missingFile)).toBe(true);

    const parsed = JSON.parse(result.stdout) as {
      goal: string;
      success: boolean;
      steps: Array<{ id: string; status: string }>;
      repair?: { changes: string[] };
      doctor?: { healthy: boolean };
    };

    expect(parsed.goal).toBe('repair');
    expect(parsed.success).toBe(true);
    expect(parsed.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'repair', status: 'completed' })]),
    );
    expect(parsed.repair?.changes).toContain('Errors.404.html');
    expect(parsed.doctor?.healthy).toBe(true);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI agent inspect still returns backend manifest when scaffold drift exists', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-agent-inspect-api-');

  try {
    await rm(path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html'), { force: true });

    const result = await runCli(
      ['agent', 'inspect', '--json', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('');

    const parsed = JSON.parse(result.stdout) as {
      goal: string;
      success: boolean;
      steps: Array<{ id: string; status: string }>;
      doctor?: { healthy: boolean };
      inspect?: { manifest: { name: string; routes?: unknown[] } };
    };

    expect(parsed.goal).toBe('inspect');
    expect(parsed.success).toBe(false);
    expect(parsed.doctor?.healthy).toBe(false);
    expect(parsed.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doctor', status: 'failed' }),
        expect.objectContaining({ id: 'backend-inspect', status: 'completed' }),
      ]),
    );
    expect(parsed.inspect?.manifest.name).toBe('webstir-demo-api');
    expect(Array.isArray(parsed.inspect?.manifest.routes)).toBe(true);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI agent scaffold-page creates a page and re-checks workspace health', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-agent-page-spa-');

  try {
    const result = await runCli([
      'agent',
      'scaffold-page',
      'about',
      '--json',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'about', 'index.html'),
      ),
    ).toBe(true);

    const parsed = JSON.parse(result.stdout) as {
      goal: string;
      success: boolean;
      scaffold?: { target: string };
    };

    expect(parsed.goal).toBe('scaffold-page');
    expect(parsed.success).toBe(true);
    expect(parsed.scaffold?.target).toBe('about');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI agent scaffold-route records backend route metadata and inspects it', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-agent-route-api-');

  try {
    const result = await runCli(
      [
        'agent',
        'scaffold-route',
        'session-sign-in',
        '--json',
        '--workspace',
        copiedWorkspace.workspaceRoot,
        '--method',
        'POST',
        '--path',
        '/session/sign-in',
        '--interaction',
        'mutation',
        '--session',
        'required',
        '--session-write',
        '--form-urlencoded',
        '--csrf',
        '--fragment-target',
        'session-panel',
        '--fragment-selector',
        '#session-panel',
        '--fragment-mode',
        'replace',
      ],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');

    const packageJson = JSON.parse(
      await readFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'), 'utf8'),
    ) as {
      webstir?: { moduleManifest?: { routes?: Array<Record<string, unknown>> } };
    };
    const route = packageJson.webstir?.moduleManifest?.routes?.find(
      (entry) => entry.method === 'POST' && entry.path === '/session/sign-in',
    );
    expect(route).toBeDefined();

    const parsed = JSON.parse(result.stdout) as {
      goal: string;
      success: boolean;
      inspect?: { manifest: { routes?: unknown[] } };
    };

    expect(parsed.goal).toBe('scaffold-route');
    expect(parsed.success).toBe(true);
    expect(Array.isArray(parsed.inspect?.manifest.routes)).toBe(true);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
