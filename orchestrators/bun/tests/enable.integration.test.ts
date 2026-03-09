import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function copyFixtureWorkspace(fixtureName: string): Promise<string> {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', fixtureName);
  const tempPrefix = fixtureName.replace(/[\\/]/g, '-');
  const workspace = await mkdtemp(path.join(os.tmpdir(), `webstir-enable-${tempPrefix}-`));
  const copiedWorkspace = path.join(workspace, fixtureName);
  await cp(fixtureRoot, copiedWorkspace, { recursive: true });
  return copiedWorkspace;
}

async function runEnableInWorkspace(
  copiedWorkspace: string,
  featureArgs: readonly string[]
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

async function readJsonFile(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

test('CLI enables search on the SSG demo workspace end to end', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('ssg/base');
  const result = await runEnableInWorkspace(copiedWorkspace, ['search']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] enable complete');
  expect(result.stdout).toContain('feature: search');

  const packageJson = await readJsonFile(path.join(copiedWorkspace, 'package.json'));
  const appTs = await readFile(path.join(copiedWorkspace, 'src', 'frontend', 'app', 'app.ts'), 'utf8');
  const appCss = await readFile(path.join(copiedWorkspace, 'src', 'frontend', 'app', 'app.css'), 'utf8');
  const appHtml = await readFile(path.join(copiedWorkspace, 'src', 'frontend', 'app', 'app.html'), 'utf8');

  expect(packageJson.webstir.enable.search).toBe(true);
  expect(existsSync(path.join(copiedWorkspace, 'src', 'frontend', 'app', 'scripts', 'features', 'search.ts'))).toBe(true);
  expect(existsSync(path.join(copiedWorkspace, 'src', 'frontend', 'app', 'styles', 'features', 'search.css'))).toBe(true);
  expect(appTs).toContain('import "./scripts/features/search.js";');
  expect(appCss).toContain('@layer reset, tokens, base, layout, components, features, utilities, overrides;');
  expect(appCss).toContain('@import "./styles/features/search.css";');
  expect(appHtml).toContain('<html data-webstir-search-styles="css" lang="en">');
});

test('CLI enables backend on the SPA demo workspace end to end', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('spa');
  const result = await runEnableInWorkspace(copiedWorkspace, ['backend']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: backend');

  const packageJson = await readJsonFile(path.join(copiedWorkspace, 'package.json'));
  const baseTsconfig = await readJsonFile(path.join(copiedWorkspace, 'base.tsconfig.json'));

  expect(packageJson.webstir.mode).toBe('full');
  expect(packageJson.webstir.enable.backend).toBe(true);
  expect(existsSync(path.join(copiedWorkspace, 'src', 'backend', 'index.ts'))).toBe(true);
  expect(baseTsconfig.references).toContainEqual({ path: 'src/backend' });
});

test('CLI enables gh-deploy with Bun-native deploy scaffolding', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('ssg/base');
  const result = await runEnableInWorkspace(copiedWorkspace, ['gh-deploy', 'demo-site']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: gh-deploy');

  const packageJson = await readJsonFile(path.join(copiedWorkspace, 'package.json'));
  const frontendConfig = await readJsonFile(
    path.join(copiedWorkspace, 'src', 'frontend', 'frontend.config.json')
  );
  const deployScript = await readFile(path.join(copiedWorkspace, 'utils', 'deploy-gh-pages.sh'), 'utf8');
  const workflow = await readFile(
    path.join(copiedWorkspace, '.github', 'workflows', 'webstir-gh-pages.yml'),
    'utf8'
  );

  expect(packageJson.webstir.enable.githubPages).toBe(true);
  expect(packageJson.scripts.deploy).toBe('bash ./utils/deploy-gh-pages.sh');
  expect(frontendConfig.publish.basePath).toBe('/demo-site');
  expect(deployScript).toContain('bunx --bun webstir-frontend publish');
  expect(workflow).toContain('uses: oven-sh/setup-bun@v2');
  expect(workflow).toContain('run: bun run deploy');
});

test('CLI enables page scripts once and rejects duplicate scaffold attempts', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('ssg/base');
  const firstRun = await runEnableInWorkspace(copiedWorkspace, ['scripts', 'home']);

  expect(firstRun.exitCode).toBe(0);
  expect(firstRun.stderr).toBe('');
  expect(existsSync(path.join(copiedWorkspace, 'src', 'frontend', 'pages', 'home', 'index.ts'))).toBe(true);

  const secondRun = await runEnableInWorkspace(copiedWorkspace, ['scripts', 'home']);
  expect(secondRun.exitCode).toBe(1);
  expect(secondRun.stderr).toContain('already has an index.ts script');
});
