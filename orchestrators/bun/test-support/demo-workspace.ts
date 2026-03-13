import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { rmSync } from 'node:fs';

import { repoRoot } from '../src/paths.ts';

export interface DemoWorkspaceCopy {
  readonly cleanupRoot: string;
  readonly workspaceRoot: string;
}

const cleanupRoots = new Set<string>();
let cleanupRegistered = false;

export async function copyDemoWorkspace(
  fixtureName: string,
  tempPrefix: string,
  options: { readonly workspaceName?: string } = {}
): Promise<DemoWorkspaceCopy> {
  registerCleanupHook();

  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', fixtureName);
  const normalizedPrefix = tempPrefix.endsWith('-') ? tempPrefix : `${tempPrefix}-`;
  const cleanupRoot = await mkdtemp(path.join(os.tmpdir(), normalizedPrefix));
  const workspaceRoot = path.join(cleanupRoot, options.workspaceName ?? fixtureName);
  await cp(fixtureRoot, workspaceRoot, { recursive: true });
  cleanupRoots.add(cleanupRoot);

  return {
    cleanupRoot,
    workspaceRoot,
  };
}

export async function removeDemoWorkspace(copy: DemoWorkspaceCopy): Promise<void> {
  cleanupRoots.delete(copy.cleanupRoot);
  await rm(copy.cleanupRoot, { recursive: true, force: true });
}

function registerCleanupHook(): void {
  if (cleanupRegistered) {
    return;
  }

  process.once('exit', () => {
    for (const cleanupRoot of cleanupRoots) {
      try {
        rmSync(cleanupRoot, { recursive: true, force: true });
      } catch {
        // Ignore temp cleanup failures during test shutdown.
      }
    }
  });

  cleanupRegistered = true;
}
