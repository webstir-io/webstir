import path from 'node:path';
import { mkdir, readdir, rm } from 'node:fs/promises';

import { scaffoldWorkspace } from './init.ts';
import type { WorkspaceMode } from './types.ts';

export interface RunRefreshOptions {
  readonly workspaceRoot: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

export interface RefreshResult {
  readonly workspaceRoot: string;
  readonly mode: WorkspaceMode;
  readonly changes: readonly string[];
}

export async function runRefresh(options: RunRefreshOptions): Promise<RefreshResult> {
  const workspaceRoot = path.resolve(options.cwd ?? process.cwd(), options.workspaceRoot);
  const modeToken = options.args[0];
  if (!modeToken) {
    throw new Error('Usage: webstir refresh <mode> --workspace <path>.');
  }

  const mode = parseWorkspaceMode(modeToken);
  await mkdir(workspaceRoot, { recursive: true });
  await emptyDirectory(workspaceRoot);

  const result = await scaffoldWorkspace(mode, workspaceRoot, { force: true });
  return {
    workspaceRoot: result.workspaceRoot,
    mode: result.mode,
    changes: result.changes,
  };
}

async function emptyDirectory(directoryPath: string): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    await rm(path.join(directoryPath, entry.name), { recursive: true, force: true });
  }
}

function parseWorkspaceMode(value: string): WorkspaceMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ssg' || normalized === 'spa' || normalized === 'api' || normalized === 'full') {
    return normalized;
  }

  if (normalized === 'fullstack') {
    return 'full';
  }

  throw new Error(`Unknown refresh mode "${value}". Expected ssg, spa, api, or full.`);
}
