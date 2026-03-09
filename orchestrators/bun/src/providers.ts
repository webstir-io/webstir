import path from 'node:path';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import type { BuildProvider, BuildTargetKind } from './types.ts';
import { monorepoRoot } from './paths.ts';
import { resolveRuntimeCommand } from './runtime.ts';

let localPackageBuildPromise: Promise<void> | null = null;

export async function loadProvider(kind: BuildTargetKind): Promise<BuildProvider> {
  await ensureLocalPackageArtifacts();
  if (kind === 'frontend') {
    const mod = await import('@webstir-io/webstir-frontend') as { frontendProvider: BuildProvider };
    return mod.frontendProvider;
  }

  const mod = await import('@webstir-io/webstir-backend') as { backendProvider: BuildProvider };
  return mod.backendProvider;
}

export async function ensureLocalPackageArtifacts(): Promise<void> {
  if (!monorepoRoot) {
    return;
  }

  const requiredEntries = [
    path.join(monorepoRoot, 'packages', 'contracts', 'module-contract', 'dist', 'index.js'),
    path.join(monorepoRoot, 'packages', 'contracts', 'testing-contract', 'dist', 'index.js'),
    path.join(monorepoRoot, 'packages', 'tooling', 'webstir-frontend', 'dist', 'index.js'),
    path.join(monorepoRoot, 'packages', 'tooling', 'webstir-frontend', 'dist', 'cli.js'),
    path.join(monorepoRoot, 'packages', 'tooling', 'webstir-backend', 'dist', 'index.js'),
    path.join(monorepoRoot, 'packages', 'tooling', 'webstir-backend', 'dist', 'watch.js'),
    path.join(monorepoRoot, 'packages', 'tooling', 'webstir-testing', 'dist', 'index.js'),
  ];

  try {
    await Promise.all(requiredEntries.map(async (entry) => await access(entry)));
    return;
  } catch {
    // Fall through to the build step.
  }

  if (!localPackageBuildPromise) {
    localPackageBuildPromise = buildLocalPackages();
  }

  await localPackageBuildPromise;
}

async function buildLocalPackages(): Promise<void> {
  const packages = [
    '@webstir-io/module-contract',
    '@webstir-io/testing-contract',
    '@webstir-io/webstir-frontend',
    '@webstir-io/webstir-backend',
    '@webstir-io/webstir-testing',
  ];

  for (const packageName of packages) {
    await runRuntimeCommand(['run', '--filter', packageName, 'build']);
  }
}

async function runRuntimeCommand(args: readonly string[]): Promise<void> {
  const cwd = monorepoRoot;
  if (!cwd) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveRuntimeCommand(), args, {
      cwd,
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed with exit code ${code}: ${args.join(' ')}`));
    });
  });
}
