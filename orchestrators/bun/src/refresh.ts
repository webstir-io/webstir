import path from 'node:path';
import os from 'node:os';
import type { BigIntStats } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';

import { scaffoldWorkspace } from './init.ts';
import {
  assertRefreshIdentity,
  assertSafeRefreshRoot,
  toRefreshIdentity,
  type RefreshIdentity,
} from './refresh-safety.ts';
import { replaceRefreshWorkspace } from './refresh-transaction.ts';
import type { WorkspaceMode } from './types.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

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
  const requestedWorkspaceRoot = path.resolve(options.cwd ?? process.cwd(), options.workspaceRoot);
  const modeToken = options.args[0];
  if (!modeToken) {
    throw new Error('Usage: webstir refresh <mode> --workspace <path>.');
  }

  const mode = parseWorkspaceMode(modeToken);
  const workspaceRoot = await resolveExistingRefreshRoot(requestedWorkspaceRoot);
  const homeRoot = await realpath(os.userInfo().homedir);
  assertSafeRefreshRoot(workspaceRoot, homeRoot);
  const snapshot = await inspectRefreshWorkspace(workspaceRoot);

  const result = await replaceRefreshWorkspace({
    workspaceRoot,
    prepareReplacement: async (replacementWorkspaceRoot) =>
      await scaffoldWorkspace(mode, replacementWorkspaceRoot, {
        force: false,
        metadata: snapshot.metadata,
        dependencyWorkspaceRoot: workspaceRoot,
      }),
    verifyIsolatedWorkspace: async (isolatedWorkspaceRoot) =>
      await verifyRefreshWorkspace(isolatedWorkspaceRoot, workspaceRoot, snapshot),
  });

  return {
    workspaceRoot,
    mode: result.mode,
    changes: result.changes,
  };
}

async function resolveExistingRefreshRoot(workspaceRoot: string): Promise<string> {
  try {
    return await realpath(workspaceRoot);
  } catch (error) {
    throw new Error(
      `Refresh requires an existing Webstir workspace at ${workspaceRoot}. Use "webstir init" to create a workspace.`,
      { cause: error },
    );
  }
}

interface RefreshWorkspaceSnapshot {
  readonly workspaceIdentity: RefreshIdentity;
  readonly manifestIdentity: RefreshIdentity;
  readonly metadata: {
    readonly packageName: string;
    readonly description?: string;
  };
}

async function inspectRefreshWorkspace(workspaceRoot: string): Promise<RefreshWorkspaceSnapshot> {
  const workspaceStats = await lstat(workspaceRoot, { bigint: true });
  if (!workspaceStats.isDirectory() || workspaceStats.isSymbolicLink()) {
    throw new Error(`Refresh target must be a real directory: ${workspaceRoot}`);
  }

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  let manifestStats: BigIntStats;
  try {
    manifestStats = await lstat(packageJsonPath, { bigint: true });
  } catch (error) {
    throw new Error(`Workspace package.json not found at ${packageJsonPath}.`, { cause: error });
  }
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw new Error(`Workspace package.json must be a regular file inside ${workspaceRoot}.`);
  }

  await readWorkspaceDescriptor(workspaceRoot);
  const metadata = await readWorkspaceManifestMetadata(workspaceRoot);

  return {
    workspaceIdentity: toRefreshIdentity(workspaceStats),
    manifestIdentity: toRefreshIdentity(manifestStats),
    metadata: {
      packageName: metadata.packageName?.trim()
        ? metadata.packageName
        : path.basename(workspaceRoot),
      description: metadata.description,
    },
  };
}

async function verifyRefreshWorkspace(
  isolatedWorkspaceRoot: string,
  requestedWorkspaceRoot: string,
  snapshot: RefreshWorkspaceSnapshot,
): Promise<void> {
  const workspaceStats = await lstat(isolatedWorkspaceRoot, { bigint: true });
  if (!workspaceStats.isDirectory() || workspaceStats.isSymbolicLink()) {
    throw new Error(
      `Refresh target changed before it could be isolated: ${requestedWorkspaceRoot}`,
    );
  }
  assertRefreshIdentity(
    snapshot.workspaceIdentity,
    toRefreshIdentity(workspaceStats),
    'workspace directory',
  );

  const manifestPath = path.join(isolatedWorkspaceRoot, 'package.json');
  const manifestStats = await lstat(manifestPath, { bigint: true });
  if (!manifestStats.isFile() || manifestStats.isSymbolicLink()) {
    throw new Error(`Workspace package.json changed before refresh: ${requestedWorkspaceRoot}`);
  }
  assertRefreshIdentity(
    snapshot.manifestIdentity,
    toRefreshIdentity(manifestStats),
    'workspace package.json',
  );
}

function parseWorkspaceMode(value: string): WorkspaceMode {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'ssg' ||
    normalized === 'spa' ||
    normalized === 'api' ||
    normalized === 'full'
  ) {
    return normalized;
  }

  if (normalized === 'fullstack') {
    return 'full';
  }

  throw new Error(`Unknown refresh mode "${value}". Expected ssg, spa, api, or full.`);
}

async function readWorkspaceManifestMetadata(
  workspaceRoot: string,
): Promise<{ readonly packageName?: string; readonly description?: string }> {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    readonly name?: string;
    readonly description?: string;
  };

  return {
    packageName: packageJson.name,
    description: packageJson.description,
  };
}
