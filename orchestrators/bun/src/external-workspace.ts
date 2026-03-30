import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';

import { monorepoRoot } from './paths.ts';
import { resolveRuntimeCommand } from './runtime.ts';

const REPO_LOCAL_PACKAGES = new Map<string, string>([
  [
    '@webstir-io/webstir-frontend',
    path.join(monorepoRoot ?? '', 'packages', 'tooling', 'webstir-frontend'),
  ],
  [
    '@webstir-io/webstir-backend',
    path.join(monorepoRoot ?? '', 'packages', 'tooling', 'webstir-backend'),
  ],
  [
    '@webstir-io/webstir-testing',
    path.join(monorepoRoot ?? '', 'packages', 'tooling', 'webstir-testing'),
  ],
]);

export async function prepareExternalWorkspaceCopy(
  workspaceRoot: string,
  tempPrefix: string,
  options: {
    readonly forceLocalPackages?: boolean;
    readonly installStdio?: 'inherit' | 'pipe';
  } = {},
): Promise<{ readonly workspaceRoot: string; readonly cleanupRoot: string } | null> {
  if (!monorepoRoot || !isExternalWorkspace(workspaceRoot)) {
    return null;
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const tempWorkspaceRoot = path.join(tempRoot, path.basename(workspaceRoot));
  await cp(workspaceRoot, tempWorkspaceRoot, { recursive: true });
  await materializeRepoLocalWorkspaceDependencies(tempWorkspaceRoot, options);

  return {
    workspaceRoot: tempWorkspaceRoot,
    cleanupRoot: tempRoot,
  };
}

export async function materializeRepoLocalWorkspaceDependencies(
  workspaceRoot: string,
  options: {
    readonly forceLocalPackages?: boolean;
    readonly installStdio?: 'inherit' | 'pipe';
  } = {},
): Promise<void> {
  if (!monorepoRoot || !isExternalWorkspace(workspaceRoot)) {
    return;
  }

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const normalized = normalizeRepoLocalDependencySpecs(packageJson, options);
  if (!normalized.changed) {
    return;
  }

  await writeFile(packageJsonPath, `${JSON.stringify(normalized.packageJson, null, 2)}\n`, 'utf8');
  const install = spawnSync(resolveRuntimeCommand(), ['install'], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: options.installStdio ?? 'inherit',
  });
  if (install.error) {
    throw install.error;
  }
  if (install.status !== 0) {
    throw new Error(`Failed to install repo-local workspace dependencies for ${workspaceRoot}.`);
  }
}

export function isExternalWorkspace(workspaceRoot: string): boolean {
  if (!monorepoRoot) {
    return true;
  }

  const relativeToRepo = path.relative(monorepoRoot, workspaceRoot);
  return relativeToRepo.startsWith('..') || path.isAbsolute(relativeToRepo);
}

function normalizeRepoLocalDependencySpecs(
  source: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
  options: {
    readonly forceLocalPackages?: boolean;
  } = {},
): {
  readonly packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  readonly changed: boolean;
} {
  let changed = false;
  const packageJson = structuredClone(source);

  for (const field of ['dependencies', 'devDependencies'] as const) {
    const entries = packageJson[field];
    if (!entries) {
      continue;
    }

    for (const [packageName, packageRoot] of REPO_LOCAL_PACKAGES) {
      if (!entries[packageName]) {
        continue;
      }
      if (!options.forceLocalPackages && entries[packageName] !== 'workspace:*') {
        continue;
      }

      entries[packageName] = `file:${packageRoot}`;
      changed = true;
    }
  }

  return { packageJson, changed };
}
