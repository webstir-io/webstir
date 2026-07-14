import { expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { resolveAddTestTarget } from '@webstir-io/webstir-testing';
import { resolvePublishedAddTestTarget } from '../src/add-test-target.ts';
import { assertNoExistingSymlinkComponents } from '../src/scaffold-path.ts';
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

test('CLI add-page rejects traversal before inspecting derived page paths', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-add-page-containment-');
  const outsideRoot = path.join(copiedWorkspace.cleanupRoot, 'outside');
  const outsideSentinel = path.join(outsideRoot, 'index.html');

  try {
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(outsideSentinel, 'keep', 'utf8');
    const result = await runCli([
      'add-page',
      '../../../../outside',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Page name must be a non-empty single path segment');
    expect(await readFile(outsideSentinel, 'utf8')).toBe('keep');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI add-page rejects page-tree and package.json symlinks before capture', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-add-page-symlink-');
  const pagesRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages');
  const outsidePagesRoot = path.join(copiedWorkspace.cleanupRoot, 'outside-pages');
  const outsidePageSentinel = path.join(outsidePagesRoot, 'about', 'index.html');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const outsidePackageJsonPath = path.join(copiedWorkspace.cleanupRoot, 'outside-package.json');

  try {
    await mkdir(path.dirname(outsidePageSentinel), { recursive: true });
    await writeFile(outsidePageSentinel, 'outside page sentinel', 'utf8');
    await rm(pagesRoot, { recursive: true, force: true });
    await symlink(outsidePagesRoot, pagesRoot, 'dir');

    const pageTreeResult = await runCli([
      'add-page',
      'about',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(pageTreeResult.exitCode).toBe(1);
    expect(pageTreeResult.stderr).toContain(
      'Refusing to inspect page scaffold files through symbolic link',
    );
    expect(await readFile(outsidePageSentinel, 'utf8')).toBe('outside page sentinel');

    await rm(pagesRoot, { force: true });
    await mkdir(pagesRoot, { recursive: true });
    const existingPageRoot = path.join(pagesRoot, 'about');
    await mkdir(existingPageRoot, { recursive: true });
    await symlink(outsidePageSentinel, path.join(existingPageRoot, 'index.html'), 'file');

    const existingPageResult = await runCli([
      'add-page',
      'about',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(existingPageResult.exitCode).toBe(1);
    expect(existingPageResult.stderr).toContain("Page 'about' already exists.");
    expect(await readFile(outsidePageSentinel, 'utf8')).toBe('outside page sentinel');

    await rm(existingPageRoot, { recursive: true, force: true });
    const packageJsonSentinel = await readFile(packageJsonPath, 'utf8');
    await writeFile(outsidePackageJsonPath, packageJsonSentinel, 'utf8');
    await rm(packageJsonPath, { force: true });
    await symlink(outsidePackageJsonPath, packageJsonPath, 'file');

    const packageJsonResult = await runCli([
      'add-page',
      'about',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(packageJsonResult.exitCode).toBe(1);
    expect(packageJsonResult.stderr).toContain(
      'Refusing to inspect workspace package.json through symbolic link',
    );
    expect(await readFile(outsidePackageJsonPath, 'utf8')).toBe(packageJsonSentinel);
    expect(existsSync(path.join(pagesRoot, 'about'))).toBe(false);

    await rm(packageJsonPath, { force: true });
    await mkdir(packageJsonPath);
    const nonRegularPackageResult = await runCli([
      'add-page',
      'about',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(nonRegularPackageResult.exitCode).toBe(1);
    expect(nonRegularPackageResult.stderr).toContain(
      'inspect workspace package.json; path is not a regular file',
    );
    expect(existsSync(path.join(pagesRoot, 'about'))).toBe(false);
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

test('CLI add-test rejects traversal without writing outside src', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-add-test-containment-');
  const outsideSentinel = path.join(copiedWorkspace.cleanupRoot, 'sentinel.txt');

  try {
    await writeFile(outsideSentinel, 'keep', 'utf8');
    const result = await runCli([
      'add-test',
      '../escape',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid test name or path');
    expect(existsSync(path.join(copiedWorkspace.workspaceRoot, 'tests', 'escape.test.ts'))).toBe(
      false,
    );
    expect(await readFile(outsideSentinel, 'utf8')).toBe('keep');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('published add-test fallback resolver preserves safe nesting and rejects unsafe paths', () => {
  const workspaceRoot = path.join(repoRoot, '.webstir-add-test-published-fallback');
  const target = resolvePublishedAddTestTarget(
    workspaceRoot,
    'frontend\\pages\\home\\page.test.ts',
  );

  expect(target).toEqual({
    normalizedName: 'frontend/pages/home/page',
    relativePath: path.join('src', 'frontend', 'pages', 'home', 'tests', 'page.test.ts'),
    absolutePath: path.join(
      workspaceRoot,
      'src',
      'frontend',
      'pages',
      'home',
      'tests',
      'page.test.ts',
    ),
  });
  expect(resolveAddTestTarget(workspaceRoot, 'frontend\\pages\\home\\page.test.ts')).toEqual(
    target,
  );

  const invalidNames = [
    '',
    '.test.ts',
    '/tmp/escape',
    'C:\\temp\\escape',
    '\\\\server\\share\\escape',
    'frontend//escape',
    'frontend/./escape',
    'frontend/../escape',
    'escape\0name',
    'control/\u0001name',
    'control/name\u007f',
    'bad<name',
    'bad>name',
    'bad:name',
    'bad"name',
    'bad|name',
    'bad?name',
    'bad*name',
    'frontend./page',
    'frontend /page',
    'page.',
    'page .test.ts',
    'CON.txt',
    'CON .txt',
    'prn.test.ts',
    'frontend/AUX.data/page',
    'NUL.json',
    'COM1.log',
    'com9',
    'COM¹',
    'com².log',
    'COM³.txt',
    'LPT1.foo',
    'lpt9',
    'LPT¹',
    'lpt².log',
    'LPT³.txt',
    'CONIN$',
    'conout$.json',
  ];
  for (const name of invalidNames) {
    expect(() => resolvePublishedAddTestTarget(workspaceRoot, name)).toThrow(
      'Invalid test name or path',
    );
    expect(() => resolveAddTestTarget(workspaceRoot, name)).toThrow('Invalid test name or path');
  }

  const validNames = [
    'frontend/页面/über test',
    'devices/COM10/report name',
    'devices/LPT0/report',
    'devices/foo.CON/report',
    'devices/CON-file/report',
  ];
  for (const name of validNames) {
    expect(resolvePublishedAddTestTarget(workspaceRoot, name)).toEqual(
      resolveAddTestTarget(workspaceRoot, name),
    );
  }
});

test('published add-test fallback rejects existing symlink components', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-add-test-fallback-symlink-');
  const outsideRoot = path.join(copiedWorkspace.cleanupRoot, 'outside');
  const linkedRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'linked');

  try {
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, linkedRoot, 'dir');
    const target = resolvePublishedAddTestTarget(copiedWorkspace.workspaceRoot, 'linked/escape');

    await expect(
      assertNoExistingSymlinkComponents(
        copiedWorkspace.workspaceRoot,
        target.absolutePath,
        'scaffold a test',
      ),
    ).rejects.toThrow('Refusing to scaffold a test through symbolic link');
    const result = await runCli([
      'add-test',
      'linked/escape',
      '--workspace',
      copiedWorkspace.workspaceRoot,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Refusing to scaffold a test through symbolic link');
    expect(existsSync(path.join(outsideRoot, 'tests', 'escape.test.ts'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});

test('CLI add-route records form and fragment metadata in the backend manifest', async () => {
  const copiedWorkspace = await copyDemoWorkspace('api', 'webstir-add-api-');

  try {
    const result = await runCli([
      'add-route',
      'session-sign-in',
      '--workspace',
      copiedWorkspace.workspaceRoot,
      '--method',
      'POST',
      '--path',
      '/session/sign-in',
      '--summary',
      'Sign in through a server-handled form',
      '--interaction',
      'mutation',
      '--session',
      'required',
      '--session-write',
      '--form-urlencoded',
      '--csrf',
      '--fragment-target',
      'session-panel',
      '--fragment-selector',
      '#session-panel',
      '--fragment-mode',
      'replace',
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('[webstir] add-route complete');
    expect(result.stdout).toContain('target: POST /session/sign-in');

    const packageJson = JSON.parse(
      await readFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'), 'utf8'),
    ) as {
      webstir?: {
        moduleManifest?: {
          routes?: Array<Record<string, unknown>>;
        };
      };
    };
    const route = packageJson.webstir?.moduleManifest?.routes?.find(
      (entry) => entry.method === 'POST' && entry.path === '/session/sign-in',
    );

    expect(route).toBeDefined();
    expect(route).toMatchObject({
      name: 'session-sign-in',
      interaction: 'mutation',
      session: {
        mode: 'required',
        write: true,
      },
      form: {
        contentType: 'application/x-www-form-urlencoded',
        csrf: true,
      },
      fragment: {
        target: 'session-panel',
        selector: '#session-panel',
        mode: 'replace',
      },
    });
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
  }
});
