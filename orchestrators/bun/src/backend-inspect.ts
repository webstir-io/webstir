import type { ModuleManifest } from '@webstir-io/module-contract';
import type { WorkspaceDescriptor } from './types.ts';

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

import { loadProvider } from './providers.ts';
import { assertNoProviderErrorDiagnostics } from './provider-diagnostics.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

const MIGRATIONS_TABLE = 'webstir_migrations';

export interface RunBackendInspectOptions {
  readonly workspaceRoot: string;
  readonly env?: Record<string, string | undefined>;
}

export interface BackendInspectResult {
  readonly workspace: WorkspaceDescriptor;
  readonly buildRoot: string;
  readonly manifest: ModuleManifest;
  readonly data: BackendDataInspectResult;
}

export interface BackendDataInspectResult {
  readonly migrations: BackendMigrationInspectResult;
}

export interface BackendMigrationInspectResult {
  readonly migrationsDirectoryPresent: boolean;
  readonly migrationsDirectory: string;
  readonly migrationFilesCount: number;
  readonly migrationFiles: readonly string[];
  /** Where the database records which migrations it has applied. */
  readonly table: typeof MIGRATIONS_TABLE;
}

export async function runBackendInspect(
  options: RunBackendInspectOptions,
): Promise<BackendInspectResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  if (!workspace.layers.server) {
    throw new Error(
      `backend-inspect needs a server, and ${workspace.name} has none (src/backend/index.ts).`,
    );
  }

  const provider = await loadProvider('backend');
  const resolvedWorkspace = await provider.resolveWorkspace({
    workspaceRoot: workspace.root,
    config: {},
  });
  const result = await provider.build({
    workspaceRoot: workspace.root,
    env: createWorkspaceRuntimeEnv(workspace.root, 'build', options.env),
    incremental: false,
  });
  assertNoProviderErrorDiagnostics('backend', 'inspect', result);
  const manifest = result.manifest.module;
  if (!manifest) {
    throw new Error('Backend manifest was not produced by the backend build.');
  }

  return {
    workspace,
    buildRoot: resolvedWorkspace.buildRoot,
    manifest,
    data: await inspectBackendData(workspace.root),
  };
}

async function inspectBackendData(workspaceRoot: string): Promise<BackendDataInspectResult> {
  return {
    migrations: await inspectMigrations(workspaceRoot),
  };
}

async function inspectMigrations(workspaceRoot: string): Promise<BackendMigrationInspectResult> {
  const migrationsDirectory = path.join('src', 'backend', 'migrations');
  const absoluteMigrationsDirectory = path.join(workspaceRoot, migrationsDirectory);
  const migrationFiles = existsSync(absoluteMigrationsDirectory)
    ? (await readdir(absoluteMigrationsDirectory))
        .filter((file) => /\.(?:sql|[cm]?[jt]s)$/.test(file) && !file.endsWith('.d.ts'))
        .sort()
    : [];

  return {
    migrationsDirectoryPresent: existsSync(absoluteMigrationsDirectory),
    migrationsDirectory,
    migrationFilesCount: migrationFiles.length,
    migrationFiles,
    table: MIGRATIONS_TABLE,
  };
}
