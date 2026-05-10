import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';

import { monorepoRoot } from './paths.ts';
import { resolveRuntimeCommand } from './runtime.ts';

const REPO_LOCAL_PACKAGES = new Map<string, string>([
  [
    '@webstir-io/module-contract',
    path.join(monorepoRoot ?? '', 'packages', 'contracts', 'module-contract'),
  ],
  [
    '@webstir-io/testing-contract',
    path.join(monorepoRoot ?? '', 'packages', 'contracts', 'testing-contract'),
  ],
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

const REPO_LOCAL_TRANSITIVE_DEPENDENCIES = new Map<string, readonly string[]>([
  ['@webstir-io/webstir-frontend', ['@webstir-io/module-contract']],
  ['@webstir-io/webstir-backend', ['@webstir-io/module-contract']],
  ['@webstir-io/webstir-testing', ['@webstir-io/testing-contract']],
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
    overrides?: Record<string, string>;
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

export function normalizeRepoLocalDependencySpecs(
  source: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  },
  options: {
    readonly forceLocalPackages?: boolean;
  } = {},
): {
  readonly packageJson: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };
  readonly changed: boolean;
} {
  let changed = false;
  const packageJson = structuredClone(source);

  function setLocalOverride(packageName: string, packageRoot: string): void {
    packageJson.overrides ??= {};
    const dependencySpec = `file:${packageRoot}`;
    if (packageJson.overrides[packageName] === dependencySpec) {
      return;
    }

    packageJson.overrides[packageName] = dependencySpec;
    changed = true;
  }

  for (const field of ['dependencies', 'devDependencies'] as const) {
    const entries = packageJson[field];
    if (!entries) {
      continue;
    }

    const localizedPackages = new Set<string>();
    for (const [packageName, packageRoot] of REPO_LOCAL_PACKAGES) {
      if (!entries[packageName]) {
        continue;
      }
      if (!options.forceLocalPackages && entries[packageName] !== 'workspace:*') {
        continue;
      }

      entries[packageName] = `file:${packageRoot}`;
      setLocalOverride(packageName, packageRoot);
      localizedPackages.add(packageName);
      changed = true;
    }

    for (const packageName of localizedPackages) {
      for (const dependencyName of REPO_LOCAL_TRANSITIVE_DEPENDENCIES.get(packageName) ?? []) {
        const dependencyRoot = REPO_LOCAL_PACKAGES.get(dependencyName);
        if (!dependencyRoot) {
          continue;
        }

        const dependencySpec = `file:${dependencyRoot}`;
        setLocalOverride(dependencyName, dependencyRoot);
        if (entries[dependencyName] === dependencySpec) {
          continue;
        }

        entries[dependencyName] = dependencySpec;
        changed = true;
      }
    }
  }

  return { packageJson, changed };
}
