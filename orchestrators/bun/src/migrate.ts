import type { MigrationStatus } from '@webstir-io/webstir-backend/db';

import path from 'node:path';
import { existsSync } from 'node:fs';

import { buildBackendForCommand } from './backend-command.ts';

function hasSignIn(workspaceRoot: string): boolean {
  return ['ts', 'tsx', 'js', 'mjs'].some((extension) =>
    existsSync(path.join(workspaceRoot, 'src', 'backend', `sign-in.${extension}`)),
  );
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
  await buildBackendForCommand(options.workspaceRoot, 'migrate');
  const { appMigrationStatus, declareWebstirTables, migrateAppDatabase } = await import(
    '@webstir-io/webstir-backend/db'
  );
  // With sign-in, the app's migrations may build on its users table.
  if (hasSignIn(options.workspaceRoot)) declareWebstirTables('sign-in');
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
