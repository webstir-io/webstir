import path from 'node:path';

export interface RefreshIdentity {
  readonly device: bigint;
  readonly inode: bigint;
}

export function assertSafeRefreshRoot(workspaceRoot: string, homeRoot: string): void {
  if (workspaceRoot === path.parse(workspaceRoot).root) {
    throw new Error(`Refusing to refresh filesystem root: ${workspaceRoot}`);
  }

  if (workspaceRoot === homeRoot) {
    throw new Error(`Refusing to refresh home directory: ${workspaceRoot}`);
  }
}

export function toRefreshIdentity(stats: {
  readonly dev: bigint;
  readonly ino: bigint;
}): RefreshIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
  };
}

export function assertRefreshIdentity(
  expected: RefreshIdentity,
  actual: RefreshIdentity,
  label: string,
): void {
  if (expected.device !== actual.device || expected.inode !== actual.inode) {
    throw new Error(`The ${label} changed during refresh; no files were deleted.`);
  }
}
