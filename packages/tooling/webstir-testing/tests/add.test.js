import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveAddTestTarget, runAddTest } from '../dist/add.js';

async function withTempRoot(prefix, run) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await run(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test('add-test preserves safe nested name-or-path inputs', async () => {
  await withTempRoot('webstir-testing-add-safe-', async (tempRoot) => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const result = await runAddTest({
      workspaceRoot,
      name: ' frontend\\pages\\home\\page.test.ts ',
    });

    assert.deepEqual(result, {
      normalizedName: 'frontend/pages/home/page',
      created: true,
      relativePath: path.join('src', 'frontend', 'pages', 'home', 'tests', 'page.test.ts'),
    });
    assert.match(
      await readFile(path.join(workspaceRoot, result.relativePath), 'utf8'),
      /sample passes/,
    );

    assert.deepEqual(await runAddTest({ workspaceRoot, name: result.normalizedName }), {
      ...result,
      created: false,
    });
  });
});

test('add-test rejects unsafe names before creating src', async () => {
  await withTempRoot('webstir-testing-add-invalid-', async (tempRoot) => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const outsideSentinel = path.join(tempRoot, 'outside.txt');
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(outsideSentinel, 'keep', 'utf8');

    const invalidNames = [
      '',
      '   ',
      '.test.ts',
      '/tmp/escape',
      'C:\\temp\\escape',
      'C:/temp/escape',
      'C:escape',
      '\\\\server\\share\\escape',
      '//server/share/escape',
      'frontend//escape',
      'frontend/./escape',
      'frontend/../escape',
      'frontend/escape/',
      'escape\0name',
    ];

    for (const name of invalidNames) {
      await assert.rejects(
        runAddTest({ workspaceRoot, name }),
        /Invalid test name or path/,
        `expected ${JSON.stringify(name)} to be rejected`,
      );
    }

    assert.equal(existsSync(path.join(workspaceRoot, 'src')), false);
    assert.equal(readFileSync(outsideSentinel, 'utf8'), 'keep');
  });
});

test('add-test rejects existing symlink components below the workspace root', async () => {
  await withTempRoot('webstir-testing-add-symlink-', async (tempRoot) => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const sourceRoot = path.join(workspaceRoot, 'src');
    const outsideRoot = path.join(tempRoot, 'outside');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await writeFile(path.join(outsideRoot, 'sentinel.txt'), 'keep', 'utf8');
    await symlink(outsideRoot, path.join(sourceRoot, 'linked'), 'dir');

    await assert.rejects(
      runAddTest({ workspaceRoot, name: 'linked/escape' }),
      /Refusing to scaffold a test through symbolic link/,
    );

    assert.equal(existsSync(path.join(outsideRoot, 'tests', 'escape.test.ts')), false);
    assert.equal(readFileSync(path.join(outsideRoot, 'sentinel.txt'), 'utf8'), 'keep');
  });
});

test('add-test rejects a non-regular target instead of reporting a duplicate no-op', async () => {
  await withTempRoot('webstir-testing-add-non-regular-', async (tempRoot) => {
    const workspaceRoot = path.join(tempRoot, 'workspace');
    const targetPath = path.join(workspaceRoot, 'src', 'tests', 'sample.test.ts');
    await mkdir(targetPath, { recursive: true });

    await assert.rejects(
      runAddTest({ workspaceRoot, name: 'sample' }),
      /Test scaffold target is not a regular file/,
    );
  });
});

test('resolveAddTestTarget keeps generated output below src', () => {
  const workspaceRoot = path.resolve(os.tmpdir(), 'webstir-testing-add-resolver');
  const target = resolveAddTestTarget(workspaceRoot, 'backend/routes/account');

  assert.equal(
    target.absolutePath,
    path.join(workspaceRoot, 'src', 'backend', 'routes', 'tests', 'account.test.ts'),
  );
  assert.equal(
    path.relative(path.join(workspaceRoot, 'src'), target.absolutePath).startsWith('..'),
    false,
  );
});

test('resolveAddTestTarget applies the portable filename policy to every path segment', () => {
  const workspaceRoot = path.resolve(os.tmpdir(), 'webstir-testing-add-portable-segments');
  const invalidNames = [
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
    assert.throws(
      () => resolveAddTestTarget(workspaceRoot, name),
      /Invalid test name or path/,
      `expected ${JSON.stringify(name)} to be rejected`,
    );
  }

  for (const name of [
    'frontend/页面/über test',
    'devices/COM10/report name',
    'devices/LPT0/report',
    'devices/foo.CON/report',
    'devices/CON-file/report',
  ]) {
    assert.equal(resolveAddTestTarget(workspaceRoot, name).normalizedName, name);
  }
});
