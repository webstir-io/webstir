import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runEnableInWorkspace(
  copiedWorkspace: string,
  featureArgs: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'enable',
      ...featureArgs,
      '--workspace',
      copiedWorkspace,
    ],
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

async function runWorkspaceCli(
  copiedWorkspace: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      ...args,
      '--workspace',
      copiedWorkspace,
    ],
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

type EnableWorkspacePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  webstir: {
    mode: string;
    enable: {
      search: boolean;
      clientNav: boolean;
      githubPages: boolean;
    };
  };
  scripts: {
    deploy: string;
  };
};

async function readJsonFile(filePath: string): Promise<EnableWorkspacePackageJson> {
  return JSON.parse(await readFile(filePath, 'utf8')) as EnableWorkspacePackageJson;
}

test('CLI enables search on the SSG demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['search']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] enable complete');
  expect(result.stdout).toContain('feature: search');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const appTs = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.ts'),
    'utf8',
  );
  const appCss = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.css'),
    'utf8',
  );
  const appHtml = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.html'),
    'utf8',
  );

  expect(packageJson.webstir.enable.search).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'search.ts',
      ),
    ),
  ).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'styles',
        'features',
        'search.css',
      ),
    ),
  ).toBe(true);
  expect(appTs).toContain('import "./scripts/features/search.js";');
  expect(appCss).toContain(
    '@layer reset, tokens, base, layout, components, features, utilities, overrides;',
  );
  expect(appCss).toContain('@import "./styles/features/search.css";');
  expect(appHtml).toContain('<html data-webstir-search-styles="css" lang="en">');
});

test('CLI enables client-nav and copies the fragment helper asset', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['client-nav']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: client-nav');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const appTs = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.ts'),
    'utf8',
  );

  expect(packageJson.webstir.enable.clientNav).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'client-nav.ts',
      ),
    ),
  ).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'form-enhancement.ts',
      ),
    ),
  ).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'document-navigation.ts',
      ),
    ),
  ).toBe(true);
  expect(appTs).toContain('import "./scripts/features/client-nav.js";');
});

test('CLI enables backend on the SPA demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-enable-spa-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['backend']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: backend');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const baseTsconfig = await readJsonFile(
    path.join(copiedWorkspace.workspaceRoot, 'base.tsconfig.json'),
  );

  expect(packageJson.webstir.mode).toBe('full');
  expect(packageJson.webstir.enable.backend).toBe(true);
  expect(packageJson.dependencies['@webstir-io/webstir-backend']).toBe('workspace:*');
  expect(packageJson.dependencies.pino).toBe('^10.1.0');
  expect(packageJson.devDependencies['@types/bun']).toBe('^1.3.11');
  expect(existsSync(path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'index.ts'))).toBe(
    true,
  );
  expect(baseTsconfig.references).toContainEqual({ path: 'src/backend' });

  const repairResult = await runWorkspaceCli(copiedWorkspace.workspaceRoot, [
    'repair',
    '--dry-run',
    '--json',
  ]);
  const repair = JSON.parse(repairResult.stdout) as { changes: string[] };
  expect(repairResult.exitCode).toBe(0);
  expect(repairResult.stderr).toBe('');
  expect(repair.changes).not.toContain('src/backend/tests/progressive-enhancement.test.ts');
  expect(repair.changes.some((change) => change.startsWith('src/backend/'))).toBe(false);
});

test('CLI enables gh-deploy with Bun-native deploy scaffolding', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
    'gh-deploy',
    'demo-site',
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: gh-deploy');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const frontendConfig = await readJsonFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'frontend.config.json'),
  );
  const deployScript = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'utils', 'deploy-gh-pages.sh'),
    'utf8',
  );
  const workflow = await readFile(
    path.join(copiedWorkspace.workspaceRoot, '.github', 'workflows', 'webstir-gh-pages.yml'),
    'utf8',
  );

  expect(packageJson.webstir.enable.githubPages).toBe(true);
  expect(packageJson.scripts.deploy).toBe('bash ./utils/deploy-gh-pages.sh');
  expect(frontendConfig.publish.basePath).toBe('/demo-site');
  expect(deployScript).toContain('bunx --bun webstir-frontend publish');
  expect(workflow).toContain('uses: oven-sh/setup-bun@v2');
  expect(workflow).toContain('run: bun run deploy');
});

test('CLI enables page scripts once and rejects duplicate scaffold attempts', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const firstRun = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
    'scripts',
    '  home  ',
  ]);

  expect(firstRun.exitCode).toBe(0);
  expect(firstRun.stderr).toBe('');
  expect(
    existsSync(
      path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.ts'),
    ),
  ).toBe(true);

  const secondRun = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['scripts', 'home']);
  expect(secondRun.exitCode).toBe(1);
  expect(secondRun.stderr).toContain('already has an index.ts script');
});

test('CLI rejects unsafe page script names without touching the workspace or outside files', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-scripts-safe-');
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-enable-scripts-outside-'));
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const pagesRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    const traversalName = path.relative(pagesRoot, externalRoot).split(path.sep).join('/');
    for (const pageName of [
      traversalName,
      traversalName.replaceAll('/', '\\'),
      '.',
      '..',
      'bad\nname',
      'home\n',
      '\thome',
      'foo:bar',
      'NUL',
      'COM¹.txt',
    ]) {
      const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
        'scripts',
        pageName,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid page name');
    }

    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'index.ts'))).toBe(false);
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.ts'),
      ),
    ).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI rejects symlinked page script ancestors and targets without following them', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-scripts-symlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-scripts-symlink-outside-'),
  );
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const linkedTargetPath = path.join(externalRoot, 'linked-index.ts');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');
  await writeFile(linkedTargetPath, 'target-sentinel', 'utf8');

  try {
    const pagesRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages');
    const linkedPagePath = path.join(pagesRoot, 'linked-page');
    await symlink(externalRoot, linkedPagePath, 'dir');

    const ancestorResult = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
      'scripts',
      'linked-page',
    ]);
    expect(ancestorResult.exitCode).toBe(1);
    expect(ancestorResult.stderr).toContain('symbolic link');
    expect(existsSync(path.join(externalRoot, 'index.ts'))).toBe(false);

    const homeRoot = path.join(pagesRoot, 'home');
    await mkdir(homeRoot, { recursive: true });
    await symlink(linkedTargetPath, path.join(homeRoot, 'index.ts'), 'file');

    const targetResult = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
      'scripts',
      'home',
    ]);
    expect(targetResult.exitCode).toBe(1);
    expect(targetResult.stderr).toContain('symbolic link');

    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(await readFile(linkedTargetPath, 'utf8')).toBe('target-sentinel');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});
