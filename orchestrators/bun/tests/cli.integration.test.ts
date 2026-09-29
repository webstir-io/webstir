import { expect, test } from 'bun:test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import { runWebstir } from '../test-support/cli.ts';

async function runCliInCopiedWorkspace(
  command: string,
  fixtureName: string,
  envOverrides: Record<string, string | undefined> = {},
  extraArgs: readonly string[] = [],
) {
  const copiedWorkspace = await copyDemoWorkspace(
    fixtureName,
    `webstir-${fixtureName.replace(/[\\/]/g, '-')}-`,
  );
  const processResult = await runCli(
    [command, '--workspace', copiedWorkspace.workspaceRoot, ...extraArgs],
    envOverrides,
  );

  return {
    copiedWorkspace: copiedWorkspace.workspaceRoot,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    exitCode: processResult.exitCode ?? -1,
  };
}

async function runCli(
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {},
): Promise<{
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}> {
  const processResult = await runWebstir(args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      BASELINE_BROWSER_MAPPING_IGNORE_OLD_DATA: 'true',
      BROWSERSLIST_IGNORE_OLD_DATA: 'true',
      ...envOverrides,
    },
  });

  return {
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    exitCode: processResult.exitCode ?? -1,
  };
}

test('CLI builds the spa demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('build', 'spa');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] build complete');
  expect(
    existsSync(path.join(result.copiedWorkspace, 'build', 'frontend', 'pages', 'home', 'index.js')),
  ).toBe(true);
});

test('CLI publishes the spa demo, pages without a server, as a static site', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'spa');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'index.html'))).toBe(
    true,
  );
  expect(
    existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'home', 'manifest.json')),
  ).toBe(true);
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages'))).toBe(false);
});

test('CLI rejects the removed --frontend-mode flag', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-spa-frontend-mode-removed-');

  try {
    const result = await runCli([
      'publish',
      '--workspace',
      copiedWorkspace.workspaceRoot,
      '--frontend-mode',
      'ssg',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown option "--frontend-mode".');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
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
  expect(
    existsSync(
      path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages', 'home', 'index.html'),
    ),
  ).toBe(true);
});

test('CLI publishes the dashboard demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'dashboard', {
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'build', 'backend', 'index.js'))).toBe(true);
  expect(
    existsSync(
      path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages', 'home', 'index.html'),
    ),
  ).toBe(true);
});

test('CLI publishes the ssg demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'ssg/base');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'index.html'))).toBe(
    true,
  );
});

test('CLI build fails when a provider reports fatal diagnostics', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-api-invalid-');

  try {
    const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      webstir?: { moduleManifest?: Record<string, unknown> };
    };
    packageJson.webstir ??= {};
    packageJson.webstir.moduleManifest ??= {};
    packageJson.webstir.moduleManifest.services = 'invalid';
    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

    const result = await runCli(['build', '--workspace', copiedWorkspace.workspaceRoot], {
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain('[webstir] build complete');
    expect(result.stderr).toContain('[webstir] build failed:');
    expect(result.stderr).toContain('backend build reported');
    expect(result.stderr).toContain('module manifest validation failed');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
