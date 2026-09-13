import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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

test('CLI repair restores missing scaffold files in a SPA workspace', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-spa-', {
    workspaceName: 'spa',
  });

  try {
    const missingRoot = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
    const missingFrontend = path.join(
      copiedWorkspace.workspaceRoot,
      'src',
      'frontend',
      'app',
      'app.html',
    );
    await rm(missingRoot, { force: true });
    await rm(missingFrontend, { force: true });

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] repair complete');
    expect(result.stdout).toContain('dry-run: false');
    expect(result.stdout).toContain('Errors.404.html');
    expect(result.stdout).toContain('src/frontend/app/app.html');
    expect(existsSync(missingRoot)).toBe(true);
    expect(existsSync(missingFrontend)).toBe(true);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair supports dry-run without restoring files', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-spa-', {
    workspaceName: 'spa',
  });

  try {
    const missingFile = path.join(copiedWorkspace.workspaceRoot, 'Errors.500.html');
    await rm(missingFile, { force: true });

    const result = await runCli([
      'repair',
      '--dry-run',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dry-run: true');
    expect(result.stdout).toContain('Errors.500.html');
    expect(existsSync(missingFile)).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair restores enabled feature assets and wiring for the SSG site demo', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/site', 'webstir-repair-ssg-site-', {
    workspaceName: 'site',
  });

  try {
    const searchScript = path.join(
      copiedWorkspace.workspaceRoot,
      'src',
      'frontend',
      'app',
      'scripts',
      'features',
      'search.ts',
    );
    const deployScript = path.join(copiedWorkspace.workspaceRoot, 'utils', 'deploy-gh-pages.sh');
    const appTsPath = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.ts');
    const appCssPath = path.join(
      copiedWorkspace.workspaceRoot,
      'src',
      'frontend',
      'app',
      'app.css',
    );
    const appHtmlPath = path.join(
      copiedWorkspace.workspaceRoot,
      'src',
      'frontend',
      'app',
      'app.html',
    );

    await rm(searchScript, { force: true });
    await rm(deployScript, { force: true });
    await writeFile(
      appTsPath,
      (await readFile(appTsPath, 'utf8')).replace('import "./scripts/features/search.js";\n', ''),
      'utf8',
    );
    await writeFile(
      appCssPath,
      (await readFile(appCssPath, 'utf8')).replace('@import "./styles/features/search.css";\n', ''),
      'utf8',
    );
    await writeFile(
      appHtmlPath,
      (await readFile(appHtmlPath, 'utf8')).replace(' data-webstir-search-styles="css"', ''),
      'utf8',
    );

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/frontend/app/scripts/features/search.ts');
    expect(result.stdout).toContain('utils/deploy-gh-pages.sh');
    expect(existsSync(searchScript)).toBe(true);
    expect(existsSync(deployScript)).toBe(true);
    expect(await readFile(appTsPath, 'utf8')).toContain('import "./scripts/features/search.js";');
    expect(await readFile(appCssPath, 'utf8')).toContain('@import "./styles/features/search.css";');
    expect(await readFile(appHtmlPath, 'utf8')).toContain('data-webstir-search-styles="css"');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

const fixturesRoot = path.join(packageRoot, 'test-support', 'fixtures');

async function prepareHotModuleWorkspace(
  prefix: string,
  files: { readonly app?: string; readonly client?: string },
): Promise<{
  readonly workspace: Awaited<ReturnType<typeof copyDemoWorkspace>>;
  readonly appTsPath: string;
  readonly clientPath: string;
  readonly currentClient: string;
}> {
  const workspace = await copyDemoWorkspace('ssg/site', prefix, { workspaceName: 'site' });
  const appDir = path.join(workspace.workspaceRoot, 'src', 'frontend', 'app');
  const appTsPath = path.join(appDir, 'app.ts');
  const clientPath = path.join(appDir, 'hmr.js');
  const currentClient = await readFile(clientPath, 'utf8');
  if (files.app !== undefined) {
    await writeFile(appTsPath, files.app, 'utf8');
  }
  if (files.client !== undefined) {
    await writeFile(clientPath, files.client, 'utf8');
  }
  return { workspace, appTsPath, clientPath, currentClient };
}

test('CLI repair replaces the scaffold hot-module registry in app.ts when the client is current', async () => {
  const legacy = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-', { app: legacy });

  try {
    const dryRun = await runCli([
      'repair',
      '--workspace',
      prepared.workspace.workspaceRoot,
      '--dry-run',
    ]);
    expect(dryRun.exitCode).toBe(0);
    expect(dryRun.stdout).toContain('src/frontend/app/app.ts');
    expect(await readFile(prepared.appTsPath, 'utf8')).toBe(legacy);

    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('  - src/frontend/app/app.ts');
    expect(result.stdout).not.toContain('  - src/frontend/app/hmr.js');
    expect(result.stdout).not.toContain('note:');

    const updated = await readFile(prepared.appTsPath, 'utf8');
    expect(updated).toContain('export function registerHotModule(');
    expect(updated).toContain('window.__webstirHotModules ??= []');
    expect(updated).not.toContain('__webstirDispose');
    expect(updated).toContain('export { loadErrorHandler };');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(prepared.currentClient);

    const again = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(again.stdout).not.toContain('src/frontend/app/app.ts');
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair moves a scaffold app.ts and a scaffold hmr.js forward together', async () => {
  const legacyApp = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const legacyClient = await readFile(
    path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'),
    'utf8',
  );
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-pair-', {
    app: legacyApp,
    client: legacyClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/frontend/app/app.ts');
    expect(result.stdout).toContain('src/frontend/app/hmr.js');
    expect(result.stdout).not.toContain('note:');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(prepared.currentClient);
    expect(await readFile(prepared.appTsPath, 'utf8')).toContain(
      'window.__webstirHotModules ??= []',
    );
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair refreshes a scaffold hmr.js left behind by a newer app.ts', async () => {
  const legacyClient = await readFile(
    path.join(fixturesRoot, 'legacy-hmr-client-spa.js.txt'),
    'utf8',
  );
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-client-', {
    client: legacyClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/frontend/app/hmr.js');
    expect(result.stdout).not.toContain('note:');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(prepared.currentClient);
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair leaves a scaffold app.ts and a customized hmr.js both unchanged, with a note', async () => {
  const legacyApp = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const customClient = `${await readFile(path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'), 'utf8')}\nconsole.log('mine');\n`;
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-custom-client-', {
    app: legacyApp,
    client: customClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'note: src/frontend/app/app.ts still installs the old hot-update hooks, and src/frontend/app/hmr.js is customized',
    );
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(customClient);
    const app = await readFile(prepared.appTsPath, 'utf8');
    expect(app).toContain('window.__webstirDispose = async');
    expect(app).not.toContain('window.__webstirHotModules ??= []');
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair reports a customized hot-module registry instead of rewriting it', async () => {
  const legacy = await readFile(path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt'), 'utf8');
  const customized = legacy.replace(
    '  try {\n    const result = record.dispose(contextWithHistory);',
    "  try {\n    console.debug('disposing', moduleId);\n    const result = record.dispose(contextWithHistory);",
  );
  expect(customized).not.toBe(legacy);
  const legacyClient = await readFile(
    path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt'),
    'utf8',
  );
  const prepared = await prepareHotModuleWorkspace('webstir-repair-hot-module-custom-app-', {
    app: customized,
    client: legacyClient,
  });

  try {
    const result = await runCli(['repair', '--workspace', prepared.workspace.workspaceRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'note: src/frontend/app/app.ts still installs the old hot-update hooks, but its registry block differs from the scaffold',
    );
    expect(result.stdout).not.toContain('  - src/frontend/app/hmr.js');
    const app = await readFile(prepared.appTsPath, 'utf8');
    expect(app).toContain("console.debug('disposing', moduleId);");
    expect(app).toContain('window.__webstirDispose = async');
    expect(await readFile(prepared.clientPath, 'utf8')).toBe(legacyClient);

    const json = await runCli([
      'repair',
      '--workspace',
      prepared.workspace.workspaceRoot,
      '--json',
    ]);
    const parsed = JSON.parse(json.stdout) as { notes: string[] };
    expect(parsed.notes).toHaveLength(1);
  } finally {
    await removeDemoWorkspace(prepared.workspace);
  }
});

test('CLI repair restores the s3-cloudfront deploy script and edge function', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-repair-ssg-s3-');
  try {
    const enable = await runCli([
      'enable',
      's3-cloudfront',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);
    expect(enable.exitCode).toBe(0);

    const deployScript = path.join(
      copiedWorkspace.workspaceRoot,
      'utils',
      'deploy-s3-cloudfront.sh',
    );
    const edgeFunction = path.join(
      copiedWorkspace.workspaceRoot,
      'utils',
      'cloudfront-rewrite-directory-index.js',
    );
    await rm(deployScript, { force: true });
    await rm(edgeFunction, { force: true });

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('utils/deploy-s3-cloudfront.sh');
    expect(result.stdout).toContain('utils/cloudfront-rewrite-directory-index.js');
    expect(existsSync(deployScript)).toBe(true);
    expect(existsSync(edgeFunction)).toBe(true);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair preserves mode ownership when an enabled feature target overlaps', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-overlap-', {
    workspaceName: 'spa',
  });
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const routerPath = path.join(
    copiedWorkspace.workspaceRoot,
    'src',
    'frontend',
    'app',
    'router.ts',
  );
  const modeRouterPath = path.join(
    packageRoot,
    'assets',
    'templates',
    'spa',
    'src',
    'frontend',
    'app',
    'router.ts',
  );

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
      webstir: { enable?: { spa?: boolean } };
    };
    packageJson.webstir.enable = { ...packageJson.webstir.enable, spa: true };
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    await rm(routerPath, { force: true });

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/frontend/app/router.ts');
    expect(await readFile(routerPath, 'utf8')).toBe(await readFile(modeRouterPath, 'utf8'));
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair emits machine-readable JSON for dry-run output', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-json-', {
    workspaceName: 'spa',
  });

  try {
    const missingFile = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
    await rm(missingFile, { force: true });

    const result = await runCli([
      'repair',
      '--dry-run',
      '--json',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(existsSync(missingFile)).toBe(false);

    const parsed = JSON.parse(result.stdout) as {
      command: string;
      workspaceRoot: string;
      mode: string;
      dryRun: boolean;
      changes: string[];
    };

    expect(parsed.command).toBe('repair');
    expect(parsed.workspaceRoot).toBe(copiedWorkspace.workspaceRoot);
    expect(parsed.mode).toBe('spa');
    expect(parsed.dryRun).toBe(true);
    expect(parsed.changes).toContain('Errors.404.html');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI repair preflights every asset before dry-run or mutation', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-assets-symlink-', {
    workspaceName: 'spa',
  });
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-repair-assets-symlink-outside-'),
  );
  const missingRootAsset = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    await rm(missingRootAsset, { force: true });
    const appRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app');
    await rm(appRoot, { recursive: true, force: true });
    await symlink(externalRoot, appRoot, 'dir');

    for (const extraArgs of [['--dry-run'], []] as const) {
      const result = await runCli([
        'repair',
        ...extraArgs,
        '--workspace',
        copiedWorkspace.workspaceRoot,
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('symbolic link');
      expect(existsSync(missingRootAsset)).toBe(false);
      expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
      expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
      expect(existsSync(path.join(externalRoot, 'app.ts'))).toBe(false);
    }
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI repair preflights enabled feature assets before restoring root assets', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/site', 'webstir-repair-feature-symlink-', {
    workspaceName: 'site',
  });
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-repair-feature-symlink-outside-'),
  );
  const missingRootAsset = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    await rm(missingRootAsset, { force: true });
    const featureStyles = path.join(
      copiedWorkspace.workspaceRoot,
      'src',
      'frontend',
      'app',
      'styles',
      'features',
    );
    await rm(featureStyles, { recursive: true, force: true });
    await symlink(externalRoot, featureStyles, 'dir');

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(existsSync(missingRootAsset)).toBe(false);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'search.css'))).toBe(false);
    expect(existsSync(path.join(externalRoot, 'content-nav.css'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI repair preflights backend provider assets before restoring root assets', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-repair-backend-symlink-', {
    workspaceName: 'spa',
  });
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-repair-backend-symlink-outside-'),
  );
  const missingRootAsset = path.join(copiedWorkspace.workspaceRoot, 'Errors.404.html');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    const enableResult = await runCli([
      'enable',
      'backend',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);
    expect(enableResult.exitCode).toBe(0);

    await rm(missingRootAsset, { force: true });
    const backendAuthRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'auth');
    await rm(backendAuthRoot, { recursive: true, force: true });
    await symlink(externalRoot, backendAuthRoot, 'dir');

    const result = await runCli(['repair', '--workspace', copiedWorkspace.workspaceRoot]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(existsSync(missingRootAsset)).toBe(false);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'adapter.ts'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});
