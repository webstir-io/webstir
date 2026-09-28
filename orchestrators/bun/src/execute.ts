import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isStaticApp } from '@webstir-io/module-contract/workspace';

import { createBuildPlan } from './build-plan.ts';
import { loadProvider } from './providers.ts';
import { assertNoProviderErrorDiagnostics } from './provider-diagnostics.ts';
import { validateRenderTemplates } from './render-validation.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import type {
  BuildProvider,
  BuildTargetKind,
  CommandExecutionResult,
  CommandMode,
  WorkspaceDescriptor,
} from './types.ts';
import { readWorkspaceDescriptor } from './workspace.ts';
import { assertNoActiveWorkspaceWatch } from './workspace-lock.ts';

export interface RunCommandOptions {
  readonly workspaceRoot: string;
  readonly env?: Record<string, string | undefined>;
  readonly loadProvider?: (kind: BuildTargetKind) => Promise<BuildProvider>;
}

export async function runCommand(
  mode: CommandMode,
  options: RunCommandOptions,
): Promise<CommandExecutionResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  await assertNoActiveWorkspaceWatch(workspace.root, mode);
  const providerLoader = options.loadProvider ?? loadProvider;
  const targets = [];
  if (isStaticApp(workspace.layers)) {
    // A static app's views load at build time, so their module compiles without a server.
    const { buildWorkspaceModuleDefinition } = await import('@webstir-io/webstir-backend');
    await buildWorkspaceModuleDefinition(workspace.root, mode);
  }

  for (const kind of createBuildPlan(workspace)) {
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
    assertNoProviderErrorDiagnostics(kind, mode, result);

    targets.push({
      kind,
      outputRoot: resolveOutputRoot(workspace.root, kind, mode, resolvedWorkspace.buildRoot),
      result,
    });
  }

  if (mode === 'publish') {
    await removeRetiredLayerOutput(workspace);
    // The deploy reads what the app is from this, since its image carries no src/.
    await mkdir(path.join(workspace.root, 'build'), { recursive: true });
    await writeFile(
      path.join(workspace.root, 'build', 'published-layers.json'),
      `${JSON.stringify(workspace.layers)}\n`,
    );
  }

  if (workspace.layers.pages) {
    await validateRenderTemplates(workspace.root);
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
  env?: Record<string, string | undefined>,
): Promise<void> {
  if (kind !== 'frontend' || mode !== 'publish') {
    return;
  }

  // Frontend publish consumes build/frontend artifacts while generating dist output.
  const result = await provider.build({
    workspaceRoot,
    env: createWorkspaceRuntimeEnv(workspaceRoot, 'build', env),
    incremental: false,
  });
  assertNoProviderErrorDiagnostics(kind, 'prebuild', result);
}

function resolveOutputRoot(
  workspaceRoot: string,
  kind: BuildTargetKind,
  mode: CommandMode,
  buildRoot: string,
): string {
  if (kind === 'frontend' && mode === 'publish') {
    return path.join(workspaceRoot, 'dist', 'frontend');
  }

  return buildRoot;
}

/**
 * A published deploy tells an app's layers from its output, so a layer the app no longer has must
 * leave no published output behind: pages removed means no dist/frontend, a server removed means
 * no server entry in build/backend.
 */
async function removeRetiredLayerOutput(workspace: WorkspaceDescriptor): Promise<void> {
  if (!workspace.layers.pages) {
    await rm(path.join(workspace.root, 'dist', 'frontend'), { recursive: true, force: true });
  }
  if (!workspace.layers.server) {
    for (const file of ['index.js', 'index.js.map']) {
      await rm(path.join(workspace.root, 'build', 'backend', file), { force: true });
    }
  }
}
