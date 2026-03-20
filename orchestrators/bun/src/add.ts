import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { runAddPage } from '@webstir-io/webstir-frontend';
import { monorepoRoot, packageRoot } from './paths.ts';

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

interface AddTestInvocationResult {
  readonly normalizedName: string;
  readonly created: boolean;
  readonly relativePath: string;
}

export async function runAddPageCommand(options: RunAddPageOptions): Promise<AddCommandResult> {
  const pageName = options.args[0];
  if (!pageName) {
    throw new Error('Usage: webstir add-page <name> --workspace <path>.');
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
    throw new Error('Usage: webstir add-test <name-or-path> --workspace <path>.');
  }

  const runAddTest = await loadAddTestRunner();
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

async function loadAddTestRunner(): Promise<(options: {
  readonly workspaceRoot: string;
  readonly name: string;
}) => Promise<AddTestInvocationResult>> {
  const mod = await import('@webstir-io/webstir-testing') as {
    runAddTest?: (options: { readonly workspaceRoot: string; readonly name: string }) => Promise<AddTestInvocationResult>;
  };
  if (typeof mod.runAddTest === 'function') {
    return mod.runAddTest;
  }

  if (monorepoRoot) {
    throw new Error('Installed @webstir-io/webstir-testing package does not export runAddTest.');
  }

  // The published regular-install path exposes the add-test binary before it exposes the helper.
  return async (options) => await runPublishedAddTestCli(options.workspaceRoot, options.name);
}

async function runPublishedAddTestCli(workspaceRoot: string, name: string): Promise<AddTestInvocationResult> {
  const target = resolveAddTestTarget(workspaceRoot, name);
  const existedBefore = existsSync(target.absolutePath);
  const binaryPath = path.join(packageRoot, '..', '..', '.bin', process.platform === 'win32' ? 'webstir-testing-add.cmd' : 'webstir-testing-add');
  const result = spawnSync(process.execPath, [binaryPath, name, '--workspace', workspaceRoot], {
    cwd: workspaceRoot,
    env: process.env,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    throw new Error(`Command failed (${result.status}): ${process.execPath} ${binaryPath} ${name} --workspace ${workspaceRoot}${detail ? `\n${detail}` : ''}`);
  }

  if (!existsSync(target.absolutePath)) {
    throw new Error(`Expected add-test output at ${target.relativePath}`);
  }

  return {
    normalizedName: target.normalizedName,
    created: !existedBefore,
    relativePath: target.relativePath,
  };
}

function resolveAddTestTarget(workspaceRoot: string, rawName: string): {
  readonly normalizedName: string;
  readonly relativePath: string;
  readonly absolutePath: string;
} {
  const normalizedName = rawName.trim().replace(/\\/g, '/').replace(/(\.test\.ts)$/i, '');
  const hasSlash = normalizedName.includes('/');

  const relativePath = hasSlash
    ? path.join('src', path.posix.dirname(normalizedName), 'tests', `${path.posix.basename(normalizedName)}.test.ts`)
    : path.join('src', 'tests', `${normalizedName}.test.ts`);

  return {
    normalizedName,
    relativePath,
    absolutePath: path.join(workspaceRoot, relativePath),
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
