import { expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

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
  envOverrides: Record<string, string | undefined>,
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
      ['backend-inspect', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stderr).toBe('');
    expect(inspectResult.stdout).toContain('[webstir] backend-inspect complete');
    expect(inspectResult.stdout).toContain('mode: api');
    expect(inspectResult.stdout).toContain('module: webstir-demo-api@1.0.0');
    expect(inspectResult.stdout).toContain('routes: 1');
    expect(inspectResult.stdout).toContain('GET /api/accounts (accounts)');
    expect(inspectResult.stdout).toContain('jobs: 1');
    expect(inspectResult.stdout).toContain(
      'nightly (schedule: 0 0 * * *, description: Nightly maintenance run, priority: 5)',
    );
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

test('CLI backend-inspect emits machine-readable JSON', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-backend-inspect-json-');

  try {
    const inspectResult = await runCliWithEnv(
      ['backend-inspect', '--json', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stderr).toBe('');

    const parsed = JSON.parse(inspectResult.stdout) as {
      command: string;
      workspace: { mode: string; root: string };
      buildRoot: string;
      manifest: { name: string; routes?: unknown[]; jobs?: unknown[] };
    };

    expect(parsed.command).toBe('backend-inspect');
    expect(parsed.workspace.mode).toBe('api');
    expect(parsed.workspace.root).toBe(copiedWorkspace.workspaceRoot);
    expect(parsed.buildRoot).toContain(
      path.join(copiedWorkspace.workspaceRoot, 'build', 'backend'),
    );
    expect(parsed.manifest.name).toBe('webstir-demo-api');
    expect(Array.isArray(parsed.manifest.routes)).toBe(true);
    expect(Array.isArray(parsed.manifest.jobs)).toBe(true);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI backend-inspect reports request-time views from manifest metadata', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-backend-inspect-views-');

  try {
    const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      webstir?: { moduleManifest?: Record<string, unknown> };
    };
    packageJson.webstir ??= {};
    packageJson.webstir.moduleManifest ??= {};
    packageJson.webstir.moduleManifest.views = [
      {
        name: 'accountView',
        path: '/accounts/:id',
        summary: 'Render one account page',
      },
    ];
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

    const inspectResult = await runCliWithEnv(
      ['backend-inspect', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stdout).toContain('views: 1');
    expect(inspectResult.stdout).toContain('/accounts/:id (accountView)');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI add-route preserves HTML-first route metadata in backend-inspect JSON', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-backend-inspect-route-meta-');

  try {
    const addRoute = await runCli([
      'add-route',
      'sign-in',
      '--method',
      'POST',
      '--path',
      '/api/sign-in',
      '--interaction',
      'mutation',
      '--session',
      'required',
      '--session-write',
      '--form-urlencoded',
      '--csrf',
      '--fragment-target',
      'sign-in-panel',
      '--fragment-mode',
      'replace',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);
    expect(addRoute.exitCode).toBe(0);

    const inspectResult = await runCliWithEnv(
      ['backend-inspect', '--json', '--workspace', copiedWorkspace.workspaceRoot],
      { WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    );

    expect(inspectResult.exitCode).toBe(0);
    expect(inspectResult.stderr).toBe('');

    const parsed = JSON.parse(inspectResult.stdout) as {
      manifest: {
        routes?: Array<{
          name: string;
          method: string;
          path: string;
          interaction?: string;
          session?: { mode?: string; write?: boolean };
          form?: { contentType?: string; csrf?: boolean };
          fragment?: { target?: string; mode?: string };
        }>;
      };
    };

    const route = parsed.manifest.routes?.find((entry) => entry.name === 'sign-in');
    expect(route).toBeTruthy();
    expect(route?.method).toBe('POST');
    expect(route?.path).toBe('/api/sign-in');
    expect(route?.interaction).toBe('mutation');
    expect(route?.session).toEqual({ mode: 'required', write: true });
    expect(route?.form).toEqual({
      contentType: 'application/x-www-form-urlencoded',
      csrf: true,
    });
    expect(route?.fragment).toEqual({ target: 'sign-in-panel', mode: 'replace' });
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
