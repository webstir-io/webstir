import { expect, test } from 'bun:test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

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
  const processResult = runCli(
    [command, '--workspace', copiedWorkspace.workspaceRoot, ...extraArgs],
    envOverrides,
  );

  return {
    copiedWorkspace: copiedWorkspace.workspaceRoot,
    stdout: processResult.stdout,
    stderr: processResult.stderr,
    exitCode: processResult.exitCode,
  };
}

function runCli(
  args: readonly string[],
  envOverrides: Record<string, string | undefined> = {},
): {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
} {
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

test('CLI builds the spa demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('build', 'spa');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] build complete');
  expect(
    existsSync(path.join(result.copiedWorkspace, 'build', 'frontend', 'pages', 'home', 'index.js')),
  ).toBe(true);
});

test('CLI publishes the spa demo workspace end to end', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'spa');

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages', 'home'))).toBe(
    true,
  );
});

test('CLI rejects missing frontend publish mode values', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-spa-frontend-mode-missing-');

  try {
    const result = runCli([
      'publish',
      '--workspace',
      copiedWorkspace.workspaceRoot,
      '--frontend-mode',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Missing value for --frontend-mode.');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI rejects unsupported frontend publish mode values', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-spa-frontend-mode-invalid-');

  try {
    const result = runCli([
      'publish',
      '--workspace',
      copiedWorkspace.workspaceRoot,
      '--frontend-mode',
      'static',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'Invalid --frontend-mode value "static". Expected bundle or ssg.',
    );
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI rejects frontend publish mode on non-publish commands', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-spa-frontend-mode-build-');

  try {
    const result = runCli([
      'build',
      '--workspace',
      copiedWorkspace.workspaceRoot,
      '--frontend-mode',
      'ssg',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Only publish accepts --frontend-mode.');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI publishes the spa demo workspace in ssg mode when frontend mode is overridden', async () => {
  const result = await runCliInCopiedWorkspace('publish', 'spa', {}, ['--frontend-mode', 'ssg']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] publish complete');
  expect(existsSync(path.join(result.copiedWorkspace, 'dist', 'frontend', 'index.html'))).toBe(
    true,
  );
  expect(
    existsSync(
      path.join(result.copiedWorkspace, 'dist', 'frontend', 'pages', 'home', 'index.html'),
    ),
  ).toBe(true);
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

    const result = runCli(['build', '--workspace', copiedWorkspace.workspaceRoot], {
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
