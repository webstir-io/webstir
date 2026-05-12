import path from 'node:path';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

export interface WorkspaceWatchLockHandle {
  readonly path: string;
  release(): Promise<void>;
}

interface WorkspaceWatchLockOwner {
  readonly kind: 'watch';
  readonly pid: number;
  readonly workspaceRoot: string;
  readonly createdAt: string;
}

interface WorkspaceWatchLockState {
  readonly exists: boolean;
  readonly active: boolean;
  readonly lockPath: string;
  readonly owner?: WorkspaceWatchLockOwner;
}

const WEBSTIR_DIR = '.webstir';
const WATCH_LOCK_DIR = 'watch.lock';
const OWNER_FILE = 'owner.json';
const UNKNOWN_OWNER_GRACE_MS = 30_000;

export class WorkspaceWatchLockConflictError extends Error {
  public constructor(
    workspaceRoot: string,
    command: 'build' | 'publish' | 'watch',
    owner?: WorkspaceWatchLockOwner,
  ) {
    const ownerDetails = owner ? ` (pid ${owner.pid})` : '';
    const action = command === 'watch' ? 'start webstir watch' : `run webstir ${command}`;
    super(
      `Cannot ${action} because webstir watch is active for this workspace${ownerDetails}. Stop the watch process before running another build pipeline against ${workspaceRoot}.`,
    );
    this.name = 'WorkspaceWatchLockConflictError';
  }
}

export async function acquireWorkspaceWatchLock(
  workspaceRoot: string,
): Promise<WorkspaceWatchLockHandle> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const lockPath = getWorkspaceWatchLockPath(resolvedRoot);
  await mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath);
      try {
        await writeOwner(lockPath, resolvedRoot);
      } catch (error) {
        await removeLockDirectory(lockPath);
        throw error;
      }
      return createLockHandle(lockPath);
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) {
        throw error;
      }

      const state = await readWorkspaceWatchLockState(resolvedRoot);
      if (state.active) {
        throw new WorkspaceWatchLockConflictError(resolvedRoot, 'watch', state.owner);
      }

      await removeLockDirectory(state.lockPath);
    }
  }

  const state = await readWorkspaceWatchLockState(resolvedRoot);
  throw new WorkspaceWatchLockConflictError(resolvedRoot, 'watch', state.owner);
}

export async function assertNoActiveWorkspaceWatch(
  workspaceRoot: string,
  command: 'build' | 'publish',
): Promise<void> {
  const resolvedRoot = path.resolve(workspaceRoot);
  const state = await readWorkspaceWatchLockState(resolvedRoot);
  if (!state.exists) {
    return;
  }

  if (state.active) {
    throw new WorkspaceWatchLockConflictError(resolvedRoot, command, state.owner);
  }

  await removeLockDirectory(state.lockPath);
}

function getWorkspaceWatchLockPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, WEBSTIR_DIR, WATCH_LOCK_DIR);
}

function createLockHandle(lockPath: string): WorkspaceWatchLockHandle {
  let released = false;

  return {
    path: lockPath,
    async release() {
      if (released) {
        return;
      }

      released = true;
      const owner = await readOwner(lockPath);
      if (owner?.pid !== process.pid) {
        return;
      }

      await removeLockDirectory(lockPath);
    },
  };
}

async function readWorkspaceWatchLockState(
  workspaceRoot: string,
): Promise<WorkspaceWatchLockState> {
  const lockPath = getWorkspaceWatchLockPath(workspaceRoot);
  let modifiedAtMs = 0;

  try {
    const stats = await lstat(lockPath);
    modifiedAtMs = stats.mtimeMs;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) {
      return { exists: false, active: false, lockPath };
    }

    throw error;
  }

  const owner = await readOwner(lockPath);
  if (!owner) {
    return {
      exists: true,
      active: Date.now() - modifiedAtMs < UNKNOWN_OWNER_GRACE_MS,
      lockPath,
    };
  }

  return {
    exists: true,
    active: isProcessActive(owner.pid),
    lockPath,
    owner,
  };
}

async function writeOwner(lockPath: string, workspaceRoot: string): Promise<void> {
  const owner: WorkspaceWatchLockOwner = {
    kind: 'watch',
    pid: process.pid,
    workspaceRoot,
    createdAt: new Date().toISOString(),
  };
  await writeFile(path.join(lockPath, OWNER_FILE), `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
}

async function readOwner(lockPath: string): Promise<WorkspaceWatchLockOwner | undefined> {
  try {
    const raw = await readFile(path.join(lockPath, OWNER_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Partial<WorkspaceWatchLockOwner>;
    if (
      parsed.kind !== 'watch' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.workspaceRoot !== 'string' ||
      typeof parsed.createdAt !== 'string'
    ) {
      return undefined;
    }

    return {
      kind: 'watch',
      pid: parsed.pid,
      workspaceRoot: parsed.workspaceRoot,
      createdAt: parsed.createdAt,
    };
  } catch {
    return undefined;
  }
}

function isProcessActive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrno(error, 'ESRCH');
  }
}

async function removeLockDirectory(lockPath: string): Promise<void> {
  await rm(lockPath, { recursive: true, force: true });
}

function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}
