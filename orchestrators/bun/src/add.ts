import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { runAddPage } from '../../../packages/tooling/webstir-frontend/src/operations.ts';
import { runAddTest } from '../../../packages/tooling/webstir-testing/src/add.ts';

export interface RunAddPageOptions {
  readonly workspaceRoot: string;
  readonly args: readonly string[];
}

export interface RunAddTestOptions {
  readonly workspaceRoot: string;
  readonly args: readonly string[];
}

export interface AddCommandResult {
  readonly workspaceRoot: string;
  readonly subject: 'page' | 'test' | 'route' | 'job';
  readonly target: string;
  readonly changes: readonly string[];
  readonly note?: string;
}

export async function runAddPageCommand(options: RunAddPageOptions): Promise<AddCommandResult> {
  const pageName = options.args[0];
  if (!pageName) {
    throw new Error('Usage: webstir-bun add-page <name> --workspace <path>.');
  }

  const pageRoot = path.join(options.workspaceRoot, 'src', 'frontend', 'pages', pageName);
  const trackedPaths = [
    path.join(pageRoot, 'index.html'),
    path.join(pageRoot, 'index.css'),
    path.join(pageRoot, 'index.ts'),
    path.join(pageRoot, 'tests', `${path.basename(pageName)}.test.ts`),
    path.join(options.workspaceRoot, 'package.json'),
  ];
  const before = await captureFileState(trackedPaths);

  await runAddPage({
    workspaceRoot: options.workspaceRoot,
    pageName,
  });

  const changes = await collectChangedFiles(options.workspaceRoot, trackedPaths, before);

  return {
    workspaceRoot: options.workspaceRoot,
    subject: 'page',
    target: pageName,
    changes,
  };
}

export async function runAddTestCommand(options: RunAddTestOptions): Promise<AddCommandResult> {
  const nameArg = options.args[0];
  if (!nameArg) {
    throw new Error('Usage: webstir-bun add-test <name-or-path> --workspace <path>.');
  }

  const result = await runAddTest({
    workspaceRoot: options.workspaceRoot,
    name: nameArg,
  });

  return {
    workspaceRoot: options.workspaceRoot,
    subject: 'test',
    target: result.normalizedName,
    changes: result.created ? [result.relativePath.replaceAll(path.sep, '/')] : [],
    note: result.created ? undefined : `File already exists: ${result.relativePath.replaceAll(path.sep, '/')}`,
  };
}

async function collectChangedFiles(
  workspaceRoot: string,
  absolutePaths: readonly string[],
  before: ReadonlyMap<string, string | null>
): Promise<string[]> {
  const changes: string[] = [];
  for (const absolutePath of absolutePaths) {
    const current = await readFileIfExists(absolutePath);
    if (current !== before.get(absolutePath)) {
      changes.push(toWorkspaceRelative(workspaceRoot, absolutePath));
    }
  }

  return changes;
}

async function captureFileState(absolutePaths: readonly string[]): Promise<Map<string, string | null>> {
  const state = new Map<string, string | null>();
  for (const absolutePath of absolutePaths) {
    state.set(absolutePath, await readFileIfExists(absolutePath));
  }

  return state;
}

async function readFileIfExists(absolutePath: string): Promise<string | null> {
  if (!existsSync(absolutePath)) {
    return null;
  }

  return await readFile(absolutePath, 'utf8');
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replaceAll(path.sep, '/');
}
