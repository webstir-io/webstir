import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runCli(args: readonly string[]) {
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

type InitWorkspacePackageJson = {
  name: string;
  description?: string;
  dependencies: Record<string, string>;
  webstir: {
    mode: string;
  };
};

async function readJson(filePath: string): Promise<InitWorkspacePackageJson> {
  return JSON.parse(await readFile(filePath, 'utf8')) as InitWorkspacePackageJson;
}

async function readPackageVersion(relativePath: string): Promise<string> {
  const packageJson = await readJson(path.join(repoRoot, relativePath));
  return packageJson.version;
}

test('CLI init scaffolds an external SSG workspace with published package versions', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-init-ssg-'));
  const workspaceRoot = path.join(tempRoot, 'docs-site');

  try {
    const frontendVersion = await readPackageVersion(
      path.join('packages', 'tooling', 'webstir-frontend', 'package.json'),
    );
    const testingVersion = await readPackageVersion(
      path.join('packages', 'tooling', 'webstir-testing', 'package.json'),
    );
    const result = await runCli(['init', 'ssg', workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] init complete');

    const packageJson = await readJson(path.join(workspaceRoot, 'package.json'));
    const baseTsconfig = await readJson(path.join(workspaceRoot, 'base.tsconfig.json'));

    expect(packageJson.name).toBe('docs-site');
    expect(packageJson.webstir.mode).toBe('ssg');
    expect(packageJson.dependencies['@webstir-io/webstir-frontend']).toBe(`^${frontendVersion}`);
    expect(packageJson.dependencies['@webstir-io/webstir-testing']).toBe(`^${testingVersion}`);
    expect(packageJson.dependencies['@webstir-io/webstir-backend']).toBeUndefined();
    expect(
      existsSync(path.join(workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.html')),
    ).toBe(true);
    expect(existsSync(path.join(workspaceRoot, 'src', 'backend'))).toBe(false);
    expect(baseTsconfig.references).toEqual([{ path: 'src/frontend' }]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CLI init keeps workspace dependencies for repo-local workspaces', async () => {
  const workspaceRoot = await mkdtemp(path.join(repoRoot, 'examples', 'demos', 'tmp-init-'));

  try {
    const result = await runCli(['init', 'spa', workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');

    const packageJson = await readJson(path.join(workspaceRoot, 'package.json'));

    expect(packageJson.webstir.mode).toBe('spa');
    expect(packageJson.dependencies['@webstir-io/webstir-frontend']).toBe('workspace:*');
    expect(packageJson.dependencies['@webstir-io/webstir-testing']).toBe('workspace:*');
    expect(packageJson.dependencies['@webstir-io/webstir-backend']).toBeUndefined();
    expect(existsSync(path.join(workspaceRoot, 'src', 'shared', 'router-types.ts'))).toBe(true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('CLI refresh clears and re-scaffolds an existing workspace', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-'));
  const workspaceRoot = path.join(tempRoot, 'full-app');

  try {
    const initResult = await runCli(['init', 'full', workspaceRoot]);
    expect(initResult.exitCode).toBe(0);

    const appHtmlPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.html');
    const originalHtml = await readFile(appHtmlPath, 'utf8');

    await writeFile(appHtmlPath, '<html><body>broken</body></html>\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'junk.txt'), 'temporary file\n', 'utf8');

    const refreshResult = await runCli(['refresh', 'full', '--workspace', workspaceRoot]);

    expect(refreshResult.exitCode).toBe(0);
    expect(refreshResult.stderr).toBe('');
    expect(refreshResult.stdout).toContain('[webstir] refresh complete');
    expect(await readFile(appHtmlPath, 'utf8')).toBe(originalHtml);
    expect(existsSync(path.join(workspaceRoot, 'junk.txt'))).toBe(false);
    expect(existsSync(path.join(workspaceRoot, 'src', 'backend', 'index.ts'))).toBe(true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CLI refresh preserves package identity from an existing workspace manifest', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-metadata-'));
  const workspaceRoot = path.join(tempRoot, 'demo-workspace');

  try {
    await runCli(['init', 'full', workspaceRoot]);

    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    const packageJson = await readJson(packageJsonPath);
    packageJson.name = 'webstir-demo-full';
    packageJson.description = 'Webstir frontend defaults and tooling';
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

    const refreshResult = await runCli(['refresh', 'full', '--workspace', workspaceRoot]);

    expect(refreshResult.exitCode).toBe(0);
    expect(refreshResult.stderr).toBe('');

    const refreshedPackageJson = await readJson(packageJsonPath);
    expect(refreshedPackageJson.name).toBe('webstir-demo-full');
    expect(refreshedPackageJson.description).toBe('Webstir frontend defaults and tooling');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
