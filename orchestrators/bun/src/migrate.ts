import type { MigrationStatus } from '@webstir-io/webstir-backend/db';

import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { buildBackendForCommand } from './backend-command.ts';

function hasSignIn(workspaceRoot: string): boolean {
  return ['ts', 'tsx', 'js', 'mjs'].some((extension) =>
    existsSync(path.join(workspaceRoot, 'src', 'backend', `sign-in.${extension}`)),
  );
}

/**
 * Sign-in's choices, from the built module, where the server reads them too. A module that cannot
 * load stops the migration, as it would stop the server, before either writes a table.
 */
async function readSignInOptions(
  workspaceRoot: string,
): Promise<{ usersTable?: 'webstir' | 'app' }> {
  const built = path.join(workspaceRoot, 'build', 'backend', 'module.js');
  const loaded = (await import(pathToFileURL(built).href)) as {
    module?: { signIn?: { usersTable?: 'webstir' | 'app' } };
  };
  return loaded.module?.signIn ?? {};
}

export interface MigrateResult {
  readonly workspaceRoot: string;
  readonly applied?: readonly string[];
  readonly status?: readonly MigrationStatus[];
}

/** Applies the app's pending migrations, or with `--status` lists them and when each was applied. */
export async function runMigrate(options: {
  readonly workspaceRoot: string;
  readonly status: boolean;
}): Promise<MigrateResult> {
  // The app's settings first: the build evaluates its module, and sign-in's choices may read them.
  const { prepareApp } = await import('@webstir-io/webstir-backend');
  prepareApp(options.workspaceRoot);
  await buildBackendForCommand(options.workspaceRoot, 'migrate');
  const { appMigrationStatus, migrateAppDatabase } = await import('@webstir-io/webstir-backend/db');
  // With sign-in, its tables come first, as the server makes them, unless the app makes `users`.
  if (hasSignIn(options.workspaceRoot)) {
    const { declareSignInTables } = await import('@webstir-io/webstir-backend/sign-in');
    declareSignInTables(await readSignInOptions(options.workspaceRoot));
  }
  if (options.status) {
    return { workspaceRoot: options.workspaceRoot, status: await appMigrationStatus() };
  }
  return { workspaceRoot: options.workspaceRoot, applied: await migrateAppDatabase() };
}

export function formatMigrateResult(result: MigrateResult): string {
  if (result.status) {
    if (result.status.length === 0) return '[webstir] no migrations (src/backend/migrations)';
    return [
      '[webstir] migrations',
      ...result.status.map(
        (entry) =>
          `  ${entry.appliedAt ? `applied ${entry.appliedAt}` : 'pending'}  ${entry.source}`,
      ),
    ].join('\n');
  }
  const applied = result.applied ?? [];
  return applied.length === 0
    ? '[webstir] migrations are up to date'
    : ['[webstir] applied', ...applied.map((id) => `  ${id}`)].join('\n');
}
