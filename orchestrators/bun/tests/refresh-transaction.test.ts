import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';

import { replaceRefreshWorkspace } from '../src/refresh-transaction.ts';

test('refresh preparation failure leaves the original byte-for-byte and removes staging', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-transaction-failure-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const packageJson = Buffer.from(
    `${JSON.stringify({ name: 'workspace', webstir: { mode: 'full' } }, null, 2)}\n`,
  );
  const sentinel = Buffer.from([0, 1, 2, 127, 128, 254, 255]);

  try {
    await mkdir(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'package.json'), packageJson);
    await writeFile(path.join(workspaceRoot, 'sentinel.bin'), sentinel);

    await expect(
      replaceRefreshWorkspace({
        workspaceRoot,
        prepareReplacement: async (replacementWorkspaceRoot) => {
          await mkdir(replacementWorkspaceRoot);
          await writeFile(path.join(replacementWorkspaceRoot, 'partial.txt'), 'partial\n');
          throw new Error('forced scaffold failure');
        },
        verifyIsolatedWorkspace: async () => {
          throw new Error('workspace must not be isolated when preparation fails');
        },
      }),
    ).rejects.toThrow('forced scaffold failure');

    expect(await readFile(path.join(workspaceRoot, 'package.json'))).toEqual(packageJson);
    expect(await readFile(path.join(workspaceRoot, 'sentinel.bin'))).toEqual(sentinel);
    expect(await readdir(tempRoot)).toEqual(['workspace']);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('refresh destination conflict preserves the destination, original, and replacement', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-transaction-conflict-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const originalSentinel = Buffer.from('original workspace\n');
  const replacementSentinel = Buffer.from('prepared replacement\n');
  const conflictSentinel = Buffer.from('concurrent destination\n');

  try {
    await mkdir(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'original.txt'), originalSentinel);

    await expect(
      replaceRefreshWorkspace({
        workspaceRoot,
        prepareReplacement: async (replacementWorkspaceRoot) => {
          await mkdir(replacementWorkspaceRoot);
          await writeFile(
            path.join(replacementWorkspaceRoot, 'replacement.txt'),
            replacementSentinel,
          );
          return undefined;
        },
        verifyIsolatedWorkspace: async () => {
          await mkdir(workspaceRoot);
          await writeFile(path.join(workspaceRoot, 'conflict.txt'), conflictSentinel);
        },
      }),
    ).rejects.toThrow('is no longer available');

    expect(await readFile(path.join(workspaceRoot, 'conflict.txt'))).toEqual(conflictSentinel);
    const transactionRoots = (await readdir(tempRoot)).filter((entry) =>
      entry.startsWith('.webstir-refresh-'),
    );
    expect(transactionRoots).toHaveLength(1);

    const transactionRoot = path.join(tempRoot, transactionRoots[0] as string);
    expect(await readFile(path.join(transactionRoot, 'workspace', 'original.txt'))).toEqual(
      originalSentinel,
    );
    expect(await readFile(path.join(transactionRoot, 'replacement', 'replacement.txt'))).toEqual(
      replacementSentinel,
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('refresh never replaces an empty destination created after isolation', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-refresh-empty-conflict-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  let conflictIdentity: { readonly dev: bigint; readonly ino: bigint } | undefined;

  try {
    await mkdir(workspaceRoot);
    await writeFile(path.join(workspaceRoot, 'original.txt'), 'original workspace\n');

    await expect(
      replaceRefreshWorkspace({
        workspaceRoot,
        prepareReplacement: async (replacementWorkspaceRoot) => {
          await mkdir(replacementWorkspaceRoot);
          await writeFile(path.join(replacementWorkspaceRoot, 'replacement.txt'), 'replacement\n');
          return undefined;
        },
        verifyIsolatedWorkspace: async () => {
          await mkdir(workspaceRoot);
          const stats = await lstat(workspaceRoot, { bigint: true });
          conflictIdentity = { dev: stats.dev, ino: stats.ino };
        },
      }),
    ).rejects.toThrow('is no longer available');

    const currentStats = await lstat(workspaceRoot, { bigint: true });
    expect({ dev: currentStats.dev, ino: currentStats.ino }).toEqual(conflictIdentity);

    const transactionRoots = (await readdir(tempRoot)).filter((entry) =>
      entry.startsWith('.webstir-refresh-'),
    );
    expect(transactionRoots).toHaveLength(1);
    const transactionRoot = path.join(tempRoot, transactionRoots[0] as string);
    expect(await readFile(path.join(transactionRoot, 'workspace', 'original.txt'), 'utf8')).toBe(
      'original workspace\n',
    );
    expect(
      await readFile(path.join(transactionRoot, 'replacement', 'replacement.txt'), 'utf8'),
    ).toBe('replacement\n');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
