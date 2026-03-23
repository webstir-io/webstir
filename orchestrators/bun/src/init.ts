import path from 'node:path';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getModeScaffoldAssets, getRootScaffoldAssets } from './init-assets.ts';
import { monorepoRoot } from './paths.ts';
import type { WorkspaceMode } from './types.ts';

const PACKAGE_MANAGER = 'bun@1.3.5';

const MODE_DESCRIPTIONS: Record<WorkspaceMode, string> = {
  ssg: 'Static site (SSG) workspace for Webstir.',
  spa: 'SPA frontend workspace for Webstir.',
  api: 'Backend API workspace for Webstir.',
  full: 'Full-stack workspace for Webstir.',
};

export interface RunInitOptions {
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly workspaceRoot?: string;
}

export interface InitResult {
  readonly workspaceRoot: string;
  readonly mode: WorkspaceMode;
  readonly packageName: string;
  readonly changes: readonly string[];
}

interface ScaffoldMetadata {
  readonly packageName?: string;
  readonly description?: string;
}

let repoWorkspacePatternsPromise: Promise<readonly string[]> | undefined;

export async function runInit(options: RunInitOptions): Promise<InitResult> {
  const request = parseInitRequest(
    options.args,
    options.workspaceRoot,
    options.cwd ?? process.cwd(),
  );
  return scaffoldWorkspace(request.mode, request.workspaceRoot, { force: false });
}

export async function scaffoldWorkspace(
  mode: WorkspaceMode,
  workspaceRoot: string,
  options: { readonly force: boolean; readonly metadata?: ScaffoldMetadata },
): Promise<InitResult> {
  if (existsSync(workspaceRoot) && !options.force && !(await isDirectoryEmpty(workspaceRoot))) {
    throw new Error(`Refusing to initialize non-empty directory: ${workspaceRoot}`);
  }

  await mkdir(workspaceRoot, { recursive: true });

  const packageName = resolvePackageName(workspaceRoot, options.metadata);
  const dependencySpecs = await resolveDependencySpecs(workspaceRoot);
  const changes: string[] = [];

  for (const asset of getRootScaffoldAssets()) {
    const targetPath = path.join(workspaceRoot, asset.targetPath);
    await copyAsset(asset.sourcePath, targetPath);
    changes.push(toWorkspaceRelative(workspaceRoot, targetPath));
  }

  for (const asset of await getModeScaffoldAssets(mode)) {
    const targetPath = path.join(workspaceRoot, asset.targetPath);
    await copyAsset(asset.sourcePath, targetPath);
    changes.push(toWorkspaceRelative(workspaceRoot, targetPath));
  }

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  await Bun.write(
    packageJsonPath,
    `${JSON.stringify(createPackageJson(mode, packageName, dependencySpecs, options.metadata), null, 2)}\n`,
  );
  changes.push('package.json');

  const baseTsconfigPath = path.join(workspaceRoot, 'base.tsconfig.json');
  await Bun.write(baseTsconfigPath, `${JSON.stringify(createBaseTsconfig(mode), null, 2)}\n`);
  changes.push('base.tsconfig.json');

  return {
    workspaceRoot,
    mode,
    packageName,
    changes: uniqueSorted(changes),
  };
}

function parseInitRequest(
  args: readonly string[],
  workspaceOverride: string | undefined,
  cwd: string,
): { readonly mode: WorkspaceMode; readonly workspaceRoot: string } {
  const [firstArg, secondArg] = args;

  if (workspaceOverride) {
    if (!firstArg) {
      throw new Error(
        'Usage: webstir init <mode> --workspace <path> or webstir init <mode> <directory>.',
      );
    }

    return {
      mode: parseWorkspaceMode(firstArg),
      workspaceRoot: path.resolve(cwd, workspaceOverride),
    };
  }

  if (!firstArg) {
    throw new Error('Usage: webstir init <mode> <directory> or webstir init <directory>.');
  }

  if (!secondArg) {
    return {
      mode: 'full',
      workspaceRoot: path.resolve(cwd, firstArg),
    };
  }

  return {
    mode: parseWorkspaceMode(firstArg),
    workspaceRoot: path.resolve(cwd, secondArg),
  };
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

  throw new Error(`Unknown init mode "${value}". Expected ssg, spa, api, or full.`);
}

async function isRepoWorkspacePath(workspaceRoot: string): Promise<boolean> {
  if (!monorepoRoot) {
    return false;
  }

  const relative = path.relative(monorepoRoot, workspaceRoot).replaceAll(path.sep, '/');
  if (!relative || relative.startsWith('..')) {
    return false;
  }

  const repoWorkspacePatterns = await readRepoWorkspacePatterns();
  return repoWorkspacePatterns.some((pattern) => matchesWorkspacePattern(relative, pattern));
}

async function resolveDependencySpecs(workspaceRoot: string): Promise<Record<string, string>> {
  if (await isRepoWorkspacePath(workspaceRoot)) {
    return {
      '@webstir-io/webstir-frontend': 'workspace:*',
      '@webstir-io/webstir-backend': 'workspace:*',
      '@webstir-io/webstir-testing': 'workspace:*',
    };
  }

  return {
    '@webstir-io/webstir-frontend': await readInstalledPackageVersion(
      '@webstir-io/webstir-frontend',
    ),
    '@webstir-io/webstir-backend': await readInstalledPackageVersion('@webstir-io/webstir-backend'),
    '@webstir-io/webstir-testing': await readInstalledPackageVersion('@webstir-io/webstir-testing'),
  };
}

async function readPackageVersion(packageJsonPath: string): Promise<string> {
  const packageJson = JSON.parse(await readTextFile(packageJsonPath)) as {
    readonly version?: string;
  };
  if (!packageJson.version) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  return `^${packageJson.version}`;
}

function createPackageJson(
  mode: WorkspaceMode,
  packageName: string,
  dependencySpecs: Record<string, string>,
  metadata: ScaffoldMetadata | undefined,
): Record<string, unknown> {
  const dependencies: Record<string, string> = {
    '@webstir-io/webstir-testing': dependencySpecs['@webstir-io/webstir-testing'],
  };

  if (mode === 'ssg' || mode === 'spa' || mode === 'full') {
    dependencies['@webstir-io/webstir-frontend'] = dependencySpecs['@webstir-io/webstir-frontend'];
  }

  if (mode === 'api' || mode === 'full') {
    dependencies['@webstir-io/webstir-backend'] = dependencySpecs['@webstir-io/webstir-backend'];
  }

  return {
    name: packageName,
    version: '1.0.0',
    private: true,
    type: 'module',
    description: metadata?.description ?? MODE_DESCRIPTIONS[mode],
    dependencies,
    devDependencies: {
      '@types/node': '^20.0.0',
      autoprefixer: '^10.4.20',
      esbuild: '^0.25.0',
      typescript: '^5.4.0',
    },
    packageManager: PACKAGE_MANAGER,
    browserslist: [
      'last 2 chrome versions',
      'last 2 firefox versions',
      'last 2 safari major versions',
      'iOS >= 14',
      'not dead',
    ],
    webstir: {
      mode,
      moduleManifest: {},
    },
  };
}

function createBaseTsconfig(mode: WorkspaceMode): Record<string, unknown> {
  const references = [];
  if (mode !== 'api') {
    if (mode !== 'ssg' && mode !== 'spa') {
      references.push({ path: 'src/shared' });
      references.push({ path: 'src/frontend' });
      references.push({ path: 'src/backend' });
    } else if (mode === 'spa') {
      references.push({ path: 'src/shared' });
      references.push({ path: 'src/frontend' });
    } else {
      references.push({ path: 'src/frontend' });
    }
  } else {
    references.push({ path: 'src/shared' });
    references.push({ path: 'src/backend' });
  }

  return {
    files: [],
    references,
    compilerOptions: {
      target: 'ES2022',
      module: 'esnext',
      moduleResolution: 'node',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      sourceMap: true,
      declaration: false,
      removeComments: true,
      typeRoots: ['./types', './node_modules/@types'],
      inlineSources: true,
    },
  };
}

function resolvePackageName(workspaceRoot: string, metadata: ScaffoldMetadata | undefined): string {
  if (metadata?.packageName?.trim()) {
    return metadata.packageName;
  }

  return sanitizePackageName(path.basename(workspaceRoot));
}

async function readInstalledPackageVersion(packageName: string): Promise<string> {
  const packageJsonUrl = import.meta.resolve(`${packageName}/package.json`);
  const packageJsonPath = fileURLToPath(packageJsonUrl);
  return await readPackageVersion(packageJsonPath);
}

function sanitizePackageName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'webstir-project';
}

async function isDirectoryEmpty(directoryPath: string): Promise<boolean> {
  const entries = await readdir(directoryPath);
  return entries.length === 0;
}

function matchesWorkspacePattern(relativePath: string, pattern: string): boolean {
  const relativeSegments = relativePath.split('/').filter(Boolean);
  const patternSegments = pattern.split('/').filter(Boolean);
  if (relativeSegments.length !== patternSegments.length) {
    return false;
  }

  return patternSegments.every(
    (segment, index) => segment === '*' || segment === relativeSegments[index],
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replaceAll(path.sep, '/');
}

async function readRepoWorkspacePatterns(): Promise<readonly string[]> {
  if (!monorepoRoot) {
    return [];
  }

  repoWorkspacePatternsPromise ??= loadRepoWorkspacePatterns();
  return await repoWorkspacePatternsPromise;
}

async function loadRepoWorkspacePatterns(): Promise<readonly string[]> {
  if (!monorepoRoot) {
    return [];
  }

  const packageJsonPath = path.join(monorepoRoot, 'package.json');
  const packageJson = JSON.parse(await readTextFile(packageJsonPath)) as {
    readonly workspaces?: readonly string[];
  };

  return packageJson.workspaces ?? [];
}

async function copyAsset(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await Bun.write(targetPath, Bun.file(sourcePath));
}

async function readTextFile(filePath: string): Promise<string> {
  return await Bun.file(filePath).text();
}
