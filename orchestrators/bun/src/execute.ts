import path from 'node:path';

import { createBuildPlan } from './build-plan.ts';
import { loadProvider } from './providers.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import type {
  BuildProvider,
  BuildTargetKind,
  CommandExecutionResult,
  CommandMode,
} from './types.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

export interface RunCommandOptions {
  readonly workspaceRoot: string;
  readonly env?: Record<string, string | undefined>;
  readonly loadProvider?: (kind: BuildTargetKind) => Promise<BuildProvider>;
}

export async function runCommand(
  mode: CommandMode,
  options: RunCommandOptions
): Promise<CommandExecutionResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  const providerLoader = options.loadProvider ?? loadProvider;
  const targets = [];

  for (const kind of createBuildPlan(workspace.mode)) {
    const provider = await providerLoader(kind);
    const resolvedWorkspace = await provider.resolveWorkspace({
      workspaceRoot: workspace.root,
      config: {},
    });
    await prepareCommandTarget(provider, workspace.root, kind, mode, options.env);
    const result = await provider.build({
      workspaceRoot: workspace.root,
      env: createWorkspaceRuntimeEnv(workspace.root, mode, options.env),
      incremental: false,
    });

    targets.push({
      kind,
      outputRoot: resolveOutputRoot(workspace.root, kind, mode, resolvedWorkspace.buildRoot),
      result,
    });
  }

  return {
    mode,
    workspace,
    targets,
  };
}

async function prepareCommandTarget(
  provider: BuildProvider,
  workspaceRoot: string,
  kind: BuildTargetKind,
  mode: CommandMode,
  env?: Record<string, string | undefined>
): Promise<void> {
  if (kind !== 'frontend' || mode !== 'publish') {
    return;
  }

  // Frontend publish consumes build/frontend artifacts while generating dist output.
  await provider.build({
    workspaceRoot,
    env: createWorkspaceRuntimeEnv(workspaceRoot, 'build', env),
    incremental: false,
  });
}

function resolveOutputRoot(
  workspaceRoot: string,
  kind: BuildTargetKind,
  mode: CommandMode,
  buildRoot: string
): string {
  if (kind === 'frontend' && mode === 'publish') {
    return path.join(workspaceRoot, 'dist', 'frontend');
  }

  return buildRoot;
}
