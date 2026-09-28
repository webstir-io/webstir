import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

import { readWorkspaceLayers } from '@webstir-io/module-contract/workspace';

import { normalizeScaffoldSegment } from './scaffold-path.ts';

export interface AddMigrationResult {
  readonly workspaceRoot: string;
  readonly target: string;
  readonly changes: readonly string[];
  readonly note: string;
}

const SQL_TEMPLATE = `-- Runs once, in a transaction, the next time the server starts.\n\n`;

const TS_TEMPLATE = `import type { Database } from '@webstir-io/webstir-backend/db';

// Runs once, in a transaction, the next time the server starts.
export async function up(db: Database): Promise<void> {
  await db.execute('SELECT 1');
}
`;

/**
 * Writes the next migration in src/backend/migrations: `0003-<name>.sql`, or `.ts` with `--ts` for
 * one that needs code.
 */
export async function runAddMigration(options: {
  readonly workspaceRoot: string;
  readonly args: readonly string[];
  readonly rawArgs: readonly string[];
}): Promise<AddMigrationResult> {
  const rawName = options.args[0];
  if (!rawName) {
    throw new Error('Usage: webstir add-migration <name> [--ts] --workspace <path>.');
  }
  const name = normalizeScaffoldSegment(rawName, 'migration');
  if (!readWorkspaceLayers(options.workspaceRoot).server) {
    throw new Error(
      'add-migration needs an app with a server (src/backend/index.ts); run `webstir enable backend` first.',
    );
  }
  const root = path.join(options.workspaceRoot, 'src', 'backend', 'migrations');
  const existing = existsSync(root) ? readdirSync(root) : [];
  const taken = existing.find((file) => file.replace(/^\d+-/, '').replace(/\.[^.]+$/, '') === name);
  if (taken) {
    throw new Error(`Migration "${name}" already exists (src/backend/migrations/${taken}).`);
  }
  const next =
    existing.reduce(
      (highest, file) => Math.max(highest, Number(/^(\d+)-/.exec(file)?.[1] ?? 0)),
      0,
    ) + 1;
  const typescript = options.rawArgs.includes('--ts');
  const file = `${String(next).padStart(4, '0')}-${name}.${typescript ? 'ts' : 'sql'}`;
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, file), typescript ? TS_TEMPLATE : SQL_TEMPLATE, { flag: 'wx' });
  const target = `src/backend/migrations/${file}`;
  return {
    workspaceRoot: options.workspaceRoot,
    target,
    changes: [target],
    note: 'Write the change in it; the server applies it once when it next starts.',
  };
}
