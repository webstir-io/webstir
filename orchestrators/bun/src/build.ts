import path from 'node:path';

import type {
  BuildExecutionResult,
  BuildProvider,
  BuildTargetKind,
} from './types.ts';
import { createBuildPlan } from './build-plan.ts';
import { repoRoot } from './paths.ts';
import { loadProvider } from './providers.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

export interface RunBuildOptions {
  readonly workspaceRoot: string;
  readonly env?: Record<string, string | undefined>;
  readonly loadProvider?: (kind: BuildTargetKind) => Promise<BuildProvider>;
}

export async function runBuild(options: RunBuildOptions): Promise<BuildExecutionResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  const providerLoader = options.loadProvider ?? loadProvider;
  const targets = [];

  for (const kind of createBuildPlan(workspace.mode)) {
    const provider = await providerLoader(kind);
    const resolvedWorkspace = await provider.resolveWorkspace({
      workspaceRoot: workspace.root,
      config: {},
    });
    const result = await provider.build({
      workspaceRoot: workspace.root,
      env: createBuildEnv(workspace.root, options.env),
      incremental: false,
    });

    targets.push({
      kind,
      buildRoot: resolvedWorkspace.buildRoot,
      result,
    });
  }

  return {
    workspace,
    targets,
  };
}

function createBuildEnv(
  workspaceRoot: string,
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
    WEBSTIR_MODULE_MODE: 'build',
  };
}
