import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
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

async function assertPackageManagedBackendScaffold(
  workspaceRoot: string,
  options: { expectModule?: boolean } = {},
): Promise<void> {
  const backendRoot = path.join(workspaceRoot, 'src', 'backend');
  const backendIndex = await readFile(path.join(backendRoot, 'index.ts'), 'utf8');

  expect(backendIndex).toContain('createDefaultBunBackendBootstrap');
  expect(backendIndex).not.toContain('http.createServer');
  expect(existsSync(path.join(backendRoot, 'server', 'bun.ts'))).toBe(false);
  expect(existsSync(path.join(backendRoot, 'runtime'))).toBe(false);
  if (options.expectModule) {
    expect(existsSync(path.join(backendRoot, 'module.ts'))).toBe(true);
  }
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
    expect((await readdir(tempRoot)).some((entry) => entry.startsWith('.webstir-refresh-'))).toBe(
      false,
    );
    await assertPackageManagedBackendScaffold(workspaceRoot, { expectModule: true });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CLI refresh refuses to create a missing workspace', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-missing-'));
  const workspaceRoot = path.join(tempRoot, 'missing-workspace');

  try {
    const refreshResult = await runCli(['refresh', 'full', '--workspace', workspaceRoot]);

    expect(refreshResult.exitCode).toBe(1);
    expect(refreshResult.stderr).toContain('Refresh requires an existing Webstir workspace');
    expect(existsSync(workspaceRoot)).toBe(false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CLI refresh preserves invalid workspace contents', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-invalid-'));
  const invalidWorkspaces = [
    {
      name: 'missing-package',
      expectedError: 'Workspace package.json not found',
    },
    {
      name: 'malformed-package',
      packageJson: '{ invalid json\n',
      expectedError: 'is not valid JSON',
    },
    {
      name: 'missing-mode',
      packageJson: `${JSON.stringify({ name: 'missing-mode' }, null, 2)}\n`,
      expectedError: 'is missing webstir.mode',
    },
    {
      name: 'unsupported-mode',
      packageJson: `${JSON.stringify({ name: 'unsupported-mode', webstir: { mode: 'legacy' } }, null, 2)}\n`,
      expectedError: 'Unsupported webstir.mode',
    },
  ] as const;

  try {
    for (const invalidWorkspace of invalidWorkspaces) {
      const workspaceRoot = path.join(tempRoot, invalidWorkspace.name);
      const sentinelPath = path.join(workspaceRoot, 'user-data.txt');
      await mkdir(workspaceRoot);
      await writeFile(sentinelPath, `preserve ${invalidWorkspace.name}\n`);

      if ('packageJson' in invalidWorkspace) {
        await writeFile(path.join(workspaceRoot, 'package.json'), invalidWorkspace.packageJson);
      }

      const refreshResult = await runCli(['refresh', 'full', '--workspace', workspaceRoot]);

      expect(refreshResult.exitCode).toBe(1);
      expect(refreshResult.stderr).toContain(invalidWorkspace.expectedError);
      expect(await readFile(sentinelPath, 'utf8')).toBe(`preserve ${invalidWorkspace.name}\n`);
      if ('packageJson' in invalidWorkspace) {
        expect(await readFile(path.join(workspaceRoot, 'package.json'), 'utf8')).toBe(
          invalidWorkspace.packageJson,
        );
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CLI refresh rejects a symlinked workspace manifest without changing contents', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-symlink-'));
  const validWorkspaceRoot = path.join(tempRoot, 'valid-workspace');
  const targetRoot = path.join(tempRoot, 'target');
  const sentinelPath = path.join(targetRoot, 'user-data.txt');
  const packageJsonPath = path.join(targetRoot, 'package.json');

  try {
    expect((await runCli(['init', 'full', validWorkspaceRoot])).exitCode).toBe(0);
    await mkdir(targetRoot);
    await writeFile(sentinelPath, 'preserve symlink target\n');
    await symlink(path.join(validWorkspaceRoot, 'package.json'), packageJsonPath);

    const refreshResult = await runCli(['refresh', 'full', '--workspace', targetRoot]);

    expect(refreshResult.exitCode).toBe(1);
    expect(refreshResult.stderr).toContain('package.json must be a regular file');
    expect(await readFile(sentinelPath, 'utf8')).toBe('preserve symlink target\n');
    expect((await lstat(packageJsonPath)).isSymbolicLink()).toBe(true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CLI refresh can change a valid workspace mode', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-mode-'));
  const workspaceRoot = path.join(tempRoot, 'mode-workspace');

  try {
    const initResult = await runCli(['init', 'spa', workspaceRoot]);
    expect(initResult.exitCode).toBe(0);

    const refreshResult = await runCli(['refresh', 'full', '--workspace', workspaceRoot]);

    expect(refreshResult.exitCode).toBe(0);
    expect(refreshResult.stderr).toBe('');
    expect((await readJson(path.join(workspaceRoot, 'package.json'))).webstir.mode).toBe('full');
    await assertPackageManagedBackendScaffold(workspaceRoot, { expectModule: true });
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

test('CLI enable backend scaffolds the package-managed Bun entrypoint', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-enable-backend-'));
  const workspaceRoot = path.join(tempRoot, 'spa-site');

  try {
    const initResult = await runCli(['init', 'spa', workspaceRoot]);
    expect(initResult.exitCode).toBe(0);

    const enableResult = await runCli(['enable', 'backend', '--workspace', workspaceRoot]);

    expect(enableResult.exitCode).toBe(0);
    expect(enableResult.stderr).toBe('');
    expect(enableResult.stdout).toContain('[webstir] enable complete');
    await assertPackageManagedBackendScaffold(workspaceRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CLI init scaffolds an external API workspace with the package-managed backend shape', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-init-api-'));
  const workspaceRoot = path.join(tempRoot, 'api-site');

  try {
    const result = await runCli(['init', 'api', workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] init complete');
    await assertPackageManagedBackendScaffold(workspaceRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('CLI init scaffolds an external full workspace with the package-managed backend shape', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-init-full-'));
  const workspaceRoot = path.join(tempRoot, 'full-site');

  try {
    const result = await runCli(['init', 'full', workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] init complete');
    await assertPackageManagedBackendScaffold(workspaceRoot, { expectModule: true });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
