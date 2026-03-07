import path from 'node:path';

import { repoRoot } from './paths.ts';

export type ModuleRuntimeMode = 'build' | 'publish';

export function createWorkspaceRuntimeEnv(
  workspaceRoot: string,
  mode: ModuleRuntimeMode,
  env: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  const binPaths = [
    path.join(workspaceRoot, 'node_modules', '.bin'),
    path.join(repoRoot, 'node_modules', '.bin'),
    env.PATH,
  ].filter(Boolean);

  return {
    ...env,
    PATH: binPaths.join(path.delimiter),
    WEBSTIR_MODULE_MODE: mode,
  };
}

export function resolveRuntimeCommand(): string {
  if (typeof process.versions.bun === 'string') {
    return process.execPath;
  }

  return 'bun';
}
