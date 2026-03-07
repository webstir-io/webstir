import path from 'node:path';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import type { BuildProvider, BuildTargetKind } from './types.ts';
import { repoRoot } from './paths.ts';
import { resolveRuntimeCommand } from './runtime.ts';

let moduleContractBuildPromise: Promise<void> | null = null;

export async function loadProvider(kind: BuildTargetKind): Promise<BuildProvider> {
  if (kind === 'frontend') {
    return await loadFrontendProvider();
  }

  await ensureModuleContractArtifacts();
  return await loadBackendProvider();
}

async function loadFrontendProvider(): Promise<BuildProvider> {
  const moduleUrl = new URL('../../../packages/tooling/webstir-frontend/src/provider.ts', import.meta.url);
  const mod = (await import(moduleUrl.href)) as { frontendProvider: BuildProvider };
  return mod.frontendProvider;
}

async function loadBackendProvider(): Promise<BuildProvider> {
  const moduleUrl = new URL('../../../packages/tooling/webstir-backend/src/provider.ts', import.meta.url);
  const mod = (await import(moduleUrl.href)) as { backendProvider: BuildProvider };
  return mod.backendProvider;
}

async function ensureModuleContractArtifacts(): Promise<void> {
  const distEntry = path.join(repoRoot, 'packages', 'contracts', 'module-contract', 'dist', 'index.js');

  try {
    await access(distEntry);
    return;
  } catch {
    // Fall through to the build step.
  }

  if (!moduleContractBuildPromise) {
    moduleContractBuildPromise = runRuntimeCommand([
      'run',
      '--filter',
      '@webstir-io/module-contract',
      'build',
    ]);
  }

  await moduleContractBuildPromise;
}

async function runRuntimeCommand(args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolveRuntimeCommand(), args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed with exit code ${code}: ${args.join(' ')}`));
    });
  });
}
