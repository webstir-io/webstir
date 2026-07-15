import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';

import { preflightScaffoldAssets, preflightWorkspaceWriteTargets } from '../src/scaffold-path.ts';

test('preflightScaffoldAssets returns canonical paths for regular assets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-asset-preflight-valid-'));
  const workspaceRoot = path.join(root, 'workspace');
  const sourcePath = path.join(root, 'source.txt');

  try {
    await mkdir(workspaceRoot);
    await writeFile(sourcePath, 'source', 'utf8');

    const [prepared] = await preflightScaffoldAssets(
      workspaceRoot,
      [{ sourcePath, targetPath: 'src\\nested/file.txt' }],
      'write test assets',
    );

    expect(prepared).toMatchObject({
      sourcePath,
      targetPath: path.join(workspaceRoot, 'src', 'nested', 'file.txt'),
      relativeTargetPath: 'src/nested/file.txt',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflightScaffoldAssets rejects non-portable, absolute, and traversal targets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-asset-preflight-target-'));
  const workspaceRoot = path.join(root, 'workspace');
  const sourcePath = path.join(root, 'source.txt');

  try {
    await mkdir(workspaceRoot);
    await writeFile(sourcePath, 'source', 'utf8');

    for (const targetPath of [
      '',
      '../outside.txt',
      '/tmp/outside.txt',
      'C:\\outside.txt',
      'src//file.txt',
      'src/./file.txt',
      'src/../file.txt',
      'src/bad\nfile.txt',
      'src/NUL.txt',
    ]) {
      await expect(
        preflightScaffoldAssets(workspaceRoot, [{ sourcePath, targetPath }], 'write test assets'),
      ).rejects.toThrow('Invalid scaffold asset target path');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflightScaffoldAssets rejects duplicate and nested target collisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-asset-preflight-duplicate-'));
  const workspaceRoot = path.join(root, 'workspace');
  const sourcePath = path.join(root, 'source.txt');

  try {
    await mkdir(workspaceRoot);
    await writeFile(sourcePath, 'source', 'utf8');

    for (const targetPaths of [
      ['src/Feature.ts', 'SRC/feature.ts'],
      ['src/conflict', 'src/conflict/child.ts'],
      ['src/conflict/child.ts', 'src/conflict'],
    ]) {
      await expect(
        preflightScaffoldAssets(
          workspaceRoot,
          targetPaths.map((targetPath) => ({ sourcePath, targetPath })),
          'write test assets',
        ),
      ).rejects.toThrow(/(?:Duplicate|Conflicting) scaffold asset target path/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflightScaffoldAssets requires regular non-symlink sources', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-asset-preflight-source-'));
  const workspaceRoot = path.join(root, 'workspace');
  const sourceDirectory = path.join(root, 'source-directory');
  const regularSource = path.join(root, 'regular-source.txt');
  const linkedSource = path.join(root, 'linked-source.txt');

  try {
    await mkdir(workspaceRoot);
    await mkdir(sourceDirectory);
    await writeFile(regularSource, 'source', 'utf8');
    await symlink(regularSource, linkedSource, 'file');

    for (const sourcePath of [
      path.join(root, 'missing-source.txt'),
      sourceDirectory,
      linkedSource,
    ]) {
      await expect(
        preflightScaffoldAssets(
          workspaceRoot,
          [{ sourcePath, targetPath: 'src/file.txt' }],
          'write test assets',
        ),
      ).rejects.toThrow(/source (?:not found|is not a regular file)/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflightScaffoldAssets rejects unsafe existing target leaves', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-asset-preflight-leaf-'));
  const workspaceRoot = path.join(root, 'workspace');
  const sourcePath = path.join(root, 'source.txt');
  const externalPath = path.join(root, 'external.txt');

  try {
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(sourcePath, 'source', 'utf8');
    await writeFile(externalPath, 'outside', 'utf8');
    await mkdir(path.join(workspaceRoot, 'src', 'directory-target'));
    await symlink(externalPath, path.join(workspaceRoot, 'src', 'linked-target'), 'file');
    await link(externalPath, path.join(workspaceRoot, 'src', 'hard-linked-target'));

    await expect(
      preflightScaffoldAssets(
        workspaceRoot,
        [{ sourcePath, targetPath: 'src/directory-target' }],
        'write test assets',
      ),
    ).rejects.toThrow('path is not a regular file');
    await expect(
      preflightScaffoldAssets(
        workspaceRoot,
        [{ sourcePath, targetPath: 'src/linked-target' }],
        'write test assets',
      ),
    ).rejects.toThrow('symbolic link');
    await expect(
      preflightScaffoldAssets(
        workspaceRoot,
        [{ sourcePath, targetPath: 'src/hard-linked-target' }],
        'write test assets',
      ),
    ).rejects.toThrow('multiple hard links');
    expect(await readFile(externalPath, 'utf8')).toBe('outside');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflightWorkspaceWriteTargets validates every fixed destination before returning', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-fixed-target-preflight-'));
  const workspaceRoot = path.join(root, 'workspace');
  const externalPath = path.join(root, 'external.txt');

  try {
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'src', 'safe.txt'), 'safe', 'utf8');
    await writeFile(externalPath, 'outside', 'utf8');
    await symlink(externalPath, path.join(workspaceRoot, 'src', 'unsafe.txt'), 'file');

    await expect(
      preflightWorkspaceWriteTargets(
        workspaceRoot,
        [
          path.join(workspaceRoot, 'src', 'safe.txt'),
          path.join(workspaceRoot, 'src', 'unsafe.txt'),
        ],
        'write test files',
      ),
    ).rejects.toThrow('symbolic link');

    expect(await readFile(externalPath, 'utf8')).toBe('outside');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
