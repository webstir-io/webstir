import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { packageRoot, repoRoot } from '../src/paths.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function copyFixtureWorkspace(fixtureName: string): Promise<string> {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', fixtureName);
  const tempPrefix = fixtureName.replace(/[\\/]/g, '-');
  const workspace = await mkdtemp(path.join(os.tmpdir(), `webstir-repair-${tempPrefix}-`));
  const copiedWorkspace = path.join(workspace, path.basename(fixtureName));
  await cp(fixtureRoot, copiedWorkspace, { recursive: true });
  return copiedWorkspace;
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
  const copiedWorkspace = await copyFixtureWorkspace('spa');

  try {
    const missingRoot = path.join(copiedWorkspace, 'Errors.404.html');
    const missingFrontend = path.join(copiedWorkspace, 'src', 'frontend', 'app', 'app.html');
    await rm(missingRoot, { force: true });
    await rm(missingFrontend, { force: true });

    const result = await runCli(['repair', '--workspace', copiedWorkspace]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('[webstir] repair complete');
    expect(result.stdout).toContain('dry-run: false');
    expect(result.stdout).toContain('Errors.404.html');
    expect(result.stdout).toContain('src/frontend/app/app.html');
    expect(existsSync(missingRoot)).toBe(true);
    expect(existsSync(missingFrontend)).toBe(true);
  } finally {
    await rm(path.dirname(copiedWorkspace), { recursive: true, force: true });
  }
});

test('CLI repair supports dry-run without restoring files', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('spa');

  try {
    const missingFile = path.join(copiedWorkspace, 'Errors.500.html');
    await rm(missingFile, { force: true });

    const result = await runCli(['repair', '--dry-run', '--workspace', copiedWorkspace]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dry-run: true');
    expect(result.stdout).toContain('Errors.500.html');
    expect(existsSync(missingFile)).toBe(false);
  } finally {
    await rm(path.dirname(copiedWorkspace), { recursive: true, force: true });
  }
});

test('CLI repair restores enabled feature assets and wiring for the SSG site demo', async () => {
  const copiedWorkspace = await copyFixtureWorkspace('ssg/site');

  try {
    const searchScript = path.join(copiedWorkspace, 'src', 'frontend', 'app', 'scripts', 'features', 'search.ts');
    const deployScript = path.join(copiedWorkspace, 'utils', 'deploy-gh-pages.sh');
    const appTsPath = path.join(copiedWorkspace, 'src', 'frontend', 'app', 'app.ts');
    const appCssPath = path.join(copiedWorkspace, 'src', 'frontend', 'app', 'app.css');
    const appHtmlPath = path.join(copiedWorkspace, 'src', 'frontend', 'app', 'app.html');

    await rm(searchScript, { force: true });
    await rm(deployScript, { force: true });
    await writeFile(
      appTsPath,
      (await readFile(appTsPath, 'utf8')).replace('import "./scripts/features/search.js";\n', ''),
      'utf8'
    );
    await writeFile(
      appCssPath,
      (await readFile(appCssPath, 'utf8')).replace('@import "./styles/features/search.css";\n', ''),
      'utf8'
    );
    await writeFile(
      appHtmlPath,
      (await readFile(appHtmlPath, 'utf8')).replace(' data-webstir-search-styles="css"', ''),
      'utf8'
    );

    const result = await runCli(['repair', '--workspace', copiedWorkspace]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/frontend/app/scripts/features/search.ts');
    expect(result.stdout).toContain('utils/deploy-gh-pages.sh');
    expect(existsSync(searchScript)).toBe(true);
    expect(existsSync(deployScript)).toBe(true);
    expect(await readFile(appTsPath, 'utf8')).toContain('import "./scripts/features/search.js";');
    expect(await readFile(appCssPath, 'utf8')).toContain('@import "./styles/features/search.css";');
    expect(await readFile(appHtmlPath, 'utf8')).toContain('data-webstir-search-styles="css"');
  } finally {
    await rm(path.dirname(copiedWorkspace), { recursive: true, force: true });
  }
});
