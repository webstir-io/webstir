import path from 'node:path';

import { packageRoot } from './paths.ts';

export type ModuleRuntimeMode = 'build' | 'publish' | 'test';

export function createWorkspaceRuntimeEnv(
  workspaceRoot: string,
  mode: ModuleRuntimeMode,
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const binPaths = [
    ...collectNodeModuleBins(workspaceRoot),
    ...collectNodeModuleBins(packageRoot),
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

function collectNodeModuleBins(startPath: string): string[] {
  const paths: string[] = [];
  let current = path.resolve(startPath);

  while (true) {
    paths.push(path.join(current, 'node_modules', '.bin'));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
  }

  return paths;
}
