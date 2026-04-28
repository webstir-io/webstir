import type { ModuleManifest } from '@webstir-io/module-contract';
import type { WorkspaceDescriptor } from './types.ts';

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

import { loadProvider } from './providers.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

const MIGRATIONS_TABLE_ENV_KEY = 'DATABASE_MIGRATIONS_TABLE';
const DEFAULT_MIGRATIONS_TABLE = '_webstir_migrations';

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
  readonly runnerPresent: boolean;
  readonly runnerPath: string;
  readonly migrationsDirectoryPresent: boolean;
  readonly migrationsDirectory: string;
  readonly migrationFilesCount: number;
  readonly migrationFiles: readonly string[];
  readonly exampleMigrationPresent: boolean;
  readonly tableEnvKey: typeof MIGRATIONS_TABLE_ENV_KEY;
  readonly configuredTable: string;
  readonly defaultTable: typeof DEFAULT_MIGRATIONS_TABLE;
}

export async function runBackendInspect(
  options: RunBackendInspectOptions,
): Promise<BackendInspectResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  if (workspace.mode !== 'api' && workspace.mode !== 'full') {
    throw new Error(
      `backend-inspect only supports api and full workspaces. Received mode "${workspace.mode}".`,
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
  const manifest = result.manifest.module;
  if (!manifest) {
    throw new Error('Backend manifest was not produced by the backend build.');
  }

  return {
    workspace,
    buildRoot: resolvedWorkspace.buildRoot,
    manifest,
    data: await inspectBackendData(workspace.root, options.env),
  };
}

async function inspectBackendData(
  workspaceRoot: string,
  env: Record<string, string | undefined> | undefined,
): Promise<BackendDataInspectResult> {
  return {
    migrations: await inspectMigrations(workspaceRoot, env),
  };
}

async function inspectMigrations(
  workspaceRoot: string,
  env: Record<string, string | undefined> | undefined,
): Promise<BackendMigrationInspectResult> {
  const runtimeEnv = env ?? process.env;
  const runnerPath = path.join('src', 'backend', 'db', 'migrate.ts');
  const migrationsDirectory = path.join('src', 'backend', 'db', 'migrations');
  const absoluteRunnerPath = path.join(workspaceRoot, runnerPath);
  const absoluteMigrationsDirectory = path.join(workspaceRoot, migrationsDirectory);
  const migrationFiles = existsSync(absoluteMigrationsDirectory)
    ? (await readdir(absoluteMigrationsDirectory))
        .filter((file) => /\.[cm]?[jt]s$/.test(file))
        .sort()
    : [];

  return {
    runnerPresent: existsSync(absoluteRunnerPath),
    runnerPath,
    migrationsDirectoryPresent: existsSync(absoluteMigrationsDirectory),
    migrationsDirectory,
    migrationFilesCount: migrationFiles.length,
    migrationFiles,
    exampleMigrationPresent: migrationFiles.includes('0001-example.ts'),
    tableEnvKey: MIGRATIONS_TABLE_ENV_KEY,
    configuredTable: runtimeEnv[MIGRATIONS_TABLE_ENV_KEY] ?? DEFAULT_MIGRATIONS_TABLE,
    defaultTable: DEFAULT_MIGRATIONS_TABLE,
  };
}
