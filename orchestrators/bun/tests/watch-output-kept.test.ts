import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { withOutputKept } from '../src/document-watch.ts';

test('withOutputKept keeps the last output unless a build succeeds', async () => {
  const cases = [
    {
      name: 'a failed build restores the output it emptied',
      build: async (root: string) => {
        await rm(root, { recursive: true, force: true });
        await mkdir(root, { recursive: true });
        throw new Error('rejected');
      },
      error: 'rejected',
      built: true,
      expected: 'last',
    },
    {
      name: 'a successful build keeps its own output and no copy',
      build: async (root: string) => writeFile(path.join(root, 'index.html'), 'next'),
      built: true,
      expected: 'next',
    },
    {
      name: 'a copy that cannot finish stops before the build touches anything',
      unreadable: true,
      build: async (root: string) => rm(root, { recursive: true, force: true }),
      error: 'EACCES',
      built: false,
      expected: 'last',
    },
  ];

  for (const entry of cases) {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'webstir-output-kept-'));
    const buildRoot = path.join(temp, 'frontend');
    const secret = path.join(buildRoot, 'secret.txt');
    await mkdir(buildRoot, { recursive: true });
    await writeFile(path.join(buildRoot, 'index.html'), 'last');
    await writeFile(secret, 'asset');
    if (entry.unreadable) await chmod(secret, 0o000);
    let built = false;

    try {
      const run = withOutputKept(buildRoot, async () => {
        built = true;
        await entry.build(buildRoot);
      });
      if (entry.error) await expect(run).rejects.toThrow(entry.error);
      else await run;

      expect({ name: entry.name, built }).toEqual({ name: entry.name, built: entry.built });
      expect(await readFile(path.join(buildRoot, 'index.html'), 'utf8')).toBe(entry.expected);
      expect(await readdir(temp)).toEqual(['frontend']);
    } finally {
      if (existsSync(secret)) await chmod(secret, 0o644);
      await rm(temp, { recursive: true, force: true });
    }
  }
});

test('withOutputKept runs a first build with nothing to keep', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'webstir-output-kept-first-'));
  try {
    await expect(
      withOutputKept(path.join(temp, 'frontend'), async () => {
        throw new Error('first build failed');
      }),
    ).rejects.toThrow('first build failed');
    expect(await readdir(temp)).toEqual([]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
