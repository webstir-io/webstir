import { expect, test } from 'bun:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
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

test('CLI add-page scaffolds a SPA page end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-add-spa-');

  try {
    const result = await runCli([
      'add-page',
      'about',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] add-page complete');
    expect(result.stdout).toContain('target: about');
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'about', 'index.html'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'about', 'index.css'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'about', 'index.ts'),
      ),
    ).toBe(true);

    const html = await readFile(
      path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'about', 'index.html'),
      'utf8',
    );
    expect(html).toContain('<title>about</title>');
    expect(html).toContain('<script type="module" src="index.js" async></script>');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI add-page scaffolds an SSG page without a page script', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-add-ssg-base-');

  try {
    const result = await runCli([
      'add-page',
      'guides',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] add-page complete');
    expect(
      existsSync(
        path.join(
          copiedWorkspace.workspaceRoot,
          'src',
          'frontend',
          'pages',
          'guides',
          'index.html',
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'guides', 'index.css'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'guides', 'index.ts'),
      ),
    ).toBe(false);

    const html = await readFile(
      path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'guides', 'index.html'),
      'utf8',
    );
    expect(html).toContain('<!-- Add index.ts to enable JS on this page. -->');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI add-test scaffolds a root-level test file', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-add-spa-');

  try {
    const result = await runCli([
      'add-test',
      'sample',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] add-test complete');
    expect(
      existsSync(path.join(copiedWorkspace.workspaceRoot, 'src', 'tests', 'sample.test.ts')),
    ).toBe(true);

    const fileContent = await readFile(
      path.join(copiedWorkspace.workspaceRoot, 'src', 'tests', 'sample.test.ts'),
      'utf8',
    );
    expect(fileContent).toContain("test('sample passes'");
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI add-test scaffolds a nested test file and reports duplicate no-op runs', async () => {
  const copiedWorkspace = await copyDemoWorkspace('full', 'webstir-add-full-');

  try {
    const firstRun = await runCli([
      'add-test',
      'frontend/pages/home/page',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(firstRun.exitCode).toBe(0);
    expect(firstRun.stderr).toBe('');
    expect(
      existsSync(
        path.join(
          copiedWorkspace.workspaceRoot,
          'src',
          'frontend',
          'pages',
          'home',
          'tests',
          'page.test.ts',
        ),
      ),
    ).toBe(true);

    const secondRun = await runCli([
      'add-test',
      'frontend/pages/home/page',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(secondRun.exitCode).toBe(0);
    expect(secondRun.stderr).toBe('');
    expect(secondRun.stdout).toContain('changes: none');
    expect(secondRun.stdout).toContain(
      'File already exists: src/frontend/pages/home/tests/page.test.ts',
    );
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
