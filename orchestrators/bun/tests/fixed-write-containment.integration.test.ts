import { expect, test } from 'bun:test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { link, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runCli(
  workspaceRoot: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      ...args,
      '--workspace',
      workspaceRoot,
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

test('CLI enable preflights fixed app targets before feature assets', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-fixed-app-');
  const appRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app');
  const appTsPath = path.join(appRoot, 'app.ts');
  const appCssPath = path.join(appRoot, 'app.css');
  const appHtmlPath = path.join(appRoot, 'app.html');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const externalRoot = path.join(copiedWorkspace.cleanupRoot, 'outside');
  const externalAppPath = path.join(externalRoot, 'app.ts');
  const before = {
    packageJson: await readFile(packageJsonPath, 'utf8'),
    appCss: await readFile(appCssPath, 'utf8'),
    appHtml: await readFile(appHtmlPath, 'utf8'),
  };

  try {
    await mkdir(externalRoot);
    await writeFile(externalAppPath, 'outside-app-sentinel\n', 'utf8');
    await rm(appTsPath);
    await symlink(externalAppPath, appTsPath, 'file');

    const result = await runCli(copiedWorkspace.workspaceRoot, ['enable', 'search']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(await readFile(externalAppPath, 'utf8')).toBe('outside-app-sentinel\n');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(before.packageJson);
    expect(await readFile(appCssPath, 'utf8')).toBe(before.appCss);
    expect(await readFile(appHtmlPath, 'utf8')).toBe(before.appHtml);
    expect(pathExists(appRoot, 'scripts', 'features', 'search.ts')).toBe(false);
    expect(pathExists(appRoot, 'styles', 'features', 'search.css')).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI enable rejects hard-linked package metadata before feature assets', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-fixed-package-');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const externalPackagePath = path.join(copiedWorkspace.cleanupRoot, 'outside-package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const appRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app');

  try {
    await writeFile(externalPackagePath, packageJson, 'utf8');
    await rm(packageJsonPath);
    await link(externalPackagePath, packageJsonPath);

    const result = await runCli(copiedWorkspace.workspaceRoot, ['enable', 'spa']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('multiple hard links');
    expect(await readFile(externalPackagePath, 'utf8')).toBe(packageJson);
    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(pathExists(appRoot, 'router.ts')).toBe(false);
    expect(pathExists(appRoot, 'router-types.ts')).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI enable backend preflights base tsconfig before assets and package metadata', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-enable-fixed-tsconfig-');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const tsconfigPath = path.join(copiedWorkspace.workspaceRoot, 'base.tsconfig.json');
  const externalTsconfigPath = path.join(copiedWorkspace.cleanupRoot, 'outside-tsconfig.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const tsconfig = await readFile(tsconfigPath, 'utf8');

  try {
    await writeFile(externalTsconfigPath, tsconfig, 'utf8');
    await rm(tsconfigPath);
    await link(externalTsconfigPath, tsconfigPath);

    const result = await runCli(copiedWorkspace.workspaceRoot, ['enable', 'backend']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('multiple hard links');
    expect(await readFile(externalTsconfigPath, 'utf8')).toBe(tsconfig);
    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(pathExists(copiedWorkspace.workspaceRoot, 'src', 'backend')).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI enable gh-deploy preflights late config targets before deploy scaffolding', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-fixed-config-');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const configPath = path.join(
    copiedWorkspace.workspaceRoot,
    'src',
    'frontend',
    'frontend.config.json',
  );
  const deployScriptPath = path.join(copiedWorkspace.workspaceRoot, 'utils', 'deploy-gh-pages.sh');
  const workflowPath = path.join(
    copiedWorkspace.workspaceRoot,
    '.github',
    'workflows',
    'webstir-gh-pages.yml',
  );
  const externalConfigPath = path.join(copiedWorkspace.cleanupRoot, 'outside-config.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const externalConfig = '{"outside":true}\n';

  try {
    await writeFile(externalConfigPath, externalConfig, 'utf8');
    await rm(configPath, { force: true });
    await symlink(externalConfigPath, configPath, 'file');

    const result = await runCli(copiedWorkspace.workspaceRoot, [
      'enable',
      'gh-deploy',
      'demo-site',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(await readFile(externalConfigPath, 'utf8')).toBe(externalConfig);
    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(existsSync(deployScriptPath)).toBe(false);
    expect(existsSync(workflowPath)).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair preflights late fixed config targets before dry-run or asset restoration', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/site', 'webstir-repair-fixed-config-', {
    workspaceName: 'site',
  });
  const missingRootAsset = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const configPath = path.join(
    copiedWorkspace.workspaceRoot,
    'src',
    'frontend',
    'frontend.config.json',
  );
  const externalConfigPath = path.join(copiedWorkspace.cleanupRoot, 'outside-config.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const externalConfig = '{"outside":true}\n';

  try {
    await rm(missingRootAsset);
    await writeFile(externalConfigPath, externalConfig, 'utf8');
    await rm(configPath, { force: true });
    await symlink(externalConfigPath, configPath, 'file');

    for (const extraArgs of [['--dry-run'], []] as const) {
      const result = await runCli(copiedWorkspace.workspaceRoot, ['repair', ...extraArgs]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('symbolic link');
      expect(existsSync(missingRootAsset)).toBe(false);
      expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
      expect(await readFile(externalConfigPath, 'utf8')).toBe(externalConfig);
    }
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair preflights mode-owned tsconfig before dry-run or asset restoration', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-repair-fixed-tsconfig-');
  const missingRootAsset = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
  const tsconfigPath = path.join(copiedWorkspace.workspaceRoot, 'base.tsconfig.json');
  const externalTsconfigPath = path.join(copiedWorkspace.cleanupRoot, 'outside-tsconfig.json');
  const tsconfig = await readFile(tsconfigPath, 'utf8');

  try {
    await rm(missingRootAsset);
    await writeFile(externalTsconfigPath, tsconfig, 'utf8');
    await rm(tsconfigPath);
    await link(externalTsconfigPath, tsconfigPath);

    for (const extraArgs of [['--dry-run'], []] as const) {
      const result = await runCli(copiedWorkspace.workspaceRoot, ['repair', ...extraArgs]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('multiple hard links');
      expect(existsSync(missingRootAsset)).toBe(false);
      expect(await readFile(externalTsconfigPath, 'utf8')).toBe(tsconfig);
    }
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

function pathExists(root: string, ...segments: string[]): boolean {
  return existsSync(path.join(root, ...segments));
}
