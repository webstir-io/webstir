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

    const appSource = await readFile(path.join(appRoot, 'app.ts'), 'utf8');
    const result = await runCli(copiedWorkspace.workspaceRoot, ['enable', 'client-nav']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('multiple hard links');
    expect(await readFile(externalPackagePath, 'utf8')).toBe(packageJson);
    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(path.join(appRoot, 'app.ts'), 'utf8')).toBe(appSource);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI enable backend preflights base tsconfig before assets and package metadata', async () => {
  // A static app from before the package tsconfigs, which still has a base.tsconfig.json.
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-fixed-tsconfig-');
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

test('CLI enable gh-deploy rejects malformed frontend config before deploy scaffolding', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-invalid-config-');
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
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const malformedConfig = '{ invalid-json\n';

  try {
    await writeFile(configPath, malformedConfig, 'utf8');

    const result = await runCli(copiedWorkspace.workspaceRoot, [
      'enable',
      'gh-deploy',
      'demo-site',
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not valid JSON');
    expect(await readFile(configPath, 'utf8')).toBe(malformedConfig);
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
  // The demos keep no AGENTS.md, so repair --restore-scaffold would write one.
  const missingRootAsset = path.join(copiedWorkspace.workspaceRoot, 'AGENTS.md');
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
    await rm(missingRootAsset, { force: true });
    await writeFile(externalConfigPath, externalConfig, 'utf8');
    await rm(configPath, { force: true });
    await symlink(externalConfigPath, configPath, 'file');

    for (const extraArgs of [['--dry-run'], []] as const) {
      const result = await runCli(copiedWorkspace.workspaceRoot, [
        'repair',
        '--restore-scaffold',
        ...extraArgs,
      ]);

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

test('CLI repair rejects invalid frontend config before dry-run or asset restoration', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/site', 'webstir-repair-invalid-config-', {
    workspaceName: 'site',
  });
  // The demos keep no AGENTS.md, so repair --restore-scaffold would write one.
  const missingRootAsset = path.join(copiedWorkspace.workspaceRoot, 'AGENTS.md');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const configPath = path.join(
    copiedWorkspace.workspaceRoot,
    'src',
    'frontend',
    'frontend.config.json',
  );
  const packageJson = await readFile(packageJsonPath, 'utf8');

  try {
    await rm(missingRootAsset, { force: true });

    for (const invalidConfig of ['{ invalid-json\n', '[]\n']) {
      await writeFile(configPath, invalidConfig, 'utf8');

      for (const extraArgs of [['--dry-run'], []] as const) {
        const result = await runCli(copiedWorkspace.workspaceRoot, [
          'repair',
          '--restore-scaffold',
          ...extraArgs,
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toMatch(/not valid JSON|must contain a JSON object/);
        expect(existsSync(missingRootAsset)).toBe(false);
        expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
        expect(await readFile(configPath, 'utf8')).toBe(invalidConfig);
      }
    }
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair preflights mode-owned tsconfig before dry-run or asset restoration', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-repair-fixed-tsconfig-');
  // The demos keep no AGENTS.md, so repair --restore-scaffold would write one.
  const missingRootAsset = path.join(copiedWorkspace.workspaceRoot, 'AGENTS.md');
  const tsconfigPath = path.join(copiedWorkspace.workspaceRoot, 'base.tsconfig.json');
  const externalTsconfigPath = path.join(copiedWorkspace.cleanupRoot, 'outside-tsconfig.json');
  const tsconfig = await readFile(tsconfigPath, 'utf8');

  try {
    await rm(missingRootAsset, { force: true });
    await writeFile(externalTsconfigPath, tsconfig, 'utf8');
    await rm(tsconfigPath);
    await link(externalTsconfigPath, tsconfigPath);

    for (const extraArgs of [['--dry-run'], []] as const) {
      const result = await runCli(copiedWorkspace.workspaceRoot, [
        'repair',
        '--restore-scaffold',
        ...extraArgs,
      ]);

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

// Repair may rewrite whichever app entry an app has, so each one is checked before anything is written.
test('CLI repair refuses a symlinked app entry before rewriting it', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-entry-symlink-', {
    workspaceName: 'spa',
  });
  const root = copiedWorkspace.workspaceRoot;
  const external = path.join(copiedWorkspace.cleanupRoot, 'outside-app.tsx');
  const legacy = await readFile(
    path.join(packageRoot, 'test-support', 'fixtures', 'app-0.7', 'app.ts.txt'),
    'utf8',
  );
  const source = `${legacy}console.log('app-owned');\n`;
  try {
    await writeFile(external, source, 'utf8');
    await symlink(external, path.join(root, 'src', 'frontend', 'app', 'app.tsx'));
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    delete packageJson.webstir.enable;
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

    const result = await runCli(root, ['repair']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(await readFile(external, 'utf8')).toBe(source);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
