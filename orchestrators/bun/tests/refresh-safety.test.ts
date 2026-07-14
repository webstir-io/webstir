import { expect, test } from 'bun:test';
import path from 'node:path';

import { assertRefreshIdentity, assertSafeRefreshRoot } from '../src/refresh-safety.ts';

test('refresh safety rejects a filesystem root', () => {
  const filesystemRoot = path.parse(process.cwd()).root;

  expect(() =>
    assertSafeRefreshRoot(filesystemRoot, path.join(filesystemRoot, 'home', 'webstir')),
  ).toThrow(/Refusing to refresh filesystem root/);
});

test('refresh safety rejects the user home directory', () => {
  const filesystemRoot = path.parse(process.cwd()).root;
  const homeRoot = path.join(filesystemRoot, 'home', 'webstir');

  expect(() => assertSafeRefreshRoot(homeRoot, homeRoot)).toThrow(
    /Refusing to refresh home directory/,
  );
});

test('refresh safety allows a nested workspace', () => {
  const filesystemRoot = path.parse(process.cwd()).root;
  const homeRoot = path.join(filesystemRoot, 'home', 'webstir');
  const workspaceRoot = path.join(homeRoot, 'projects', 'site');

  expect(() => assertSafeRefreshRoot(workspaceRoot, homeRoot)).not.toThrow();
});

test('refresh safety rejects a changed filesystem identity', () => {
  expect(() =>
    assertRefreshIdentity(
      { device: 1n, inode: 2n },
      { device: 1n, inode: 3n },
      'workspace directory',
    ),
  ).toThrow(/workspace directory changed during refresh/);

  expect(() =>
    assertRefreshIdentity(
      { device: 1n, inode: 2n },
      { device: 1n, inode: 2n },
      'workspace directory',
    ),
  ).not.toThrow();
});
