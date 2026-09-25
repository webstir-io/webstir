import path from 'node:path';

import type { ModuleDiagnostic } from '@webstir-io/module-contract';

import { discoverModuleDefinitionSource, ensureModuleDefinitionBuild } from './pipeline.js';

/**
 * Compiles only the workspace's module definition to `build/backend/module.js`, for tools that
 * read its views without running a server, such as an SSG publish. Returns false when the
 * workspace has no module.
 */
export async function buildWorkspaceModuleDefinition(
  workspaceRoot: string,
  mode: 'build' | 'publish' = 'build',
): Promise<boolean> {
  const sourceRoot = path.join(workspaceRoot, 'src', 'backend');
  if (!(await discoverModuleDefinitionSource(sourceRoot))) {
    return false;
  }
  const diagnostics: ModuleDiagnostic[] = [];
  await ensureModuleDefinitionBuild({
    sourceRoot,
    buildRoot: path.join(workspaceRoot, 'build', 'backend'),
    tsconfigPath: path.join(sourceRoot, 'tsconfig.json'),
    mode,
    env: process.env,
    diagnostics,
  });
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `[webstir-backend] ${path.relative(workspaceRoot, sourceRoot)}/module failed to build:\n${errors.map((error) => error.message).join('\n')}`,
    );
  }
  return true;
}

export async function hasWorkspaceModuleDefinition(workspaceRoot: string): Promise<boolean> {
  return Boolean(await discoverModuleDefinitionSource(path.join(workspaceRoot, 'src', 'backend')));
}
