import type { ModuleManifest } from '@webstir-io/module-contract';
import type { WorkspaceDescriptor } from './types.ts';

import { loadProvider } from './providers.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

export interface RunBackendInspectOptions {
  readonly workspaceRoot: string;
  readonly env?: Record<string, string | undefined>;
}

export interface BackendInspectResult {
  readonly workspace: WorkspaceDescriptor;
  readonly buildRoot: string;
  readonly manifest: ModuleManifest;
}

export async function runBackendInspect(
  options: RunBackendInspectOptions,
): Promise<BackendInspectResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  if (workspace.mode !== 'api' && workspace.mode !== 'full') {
    throw new Error(
      `backend-inspect only supports api and full workspaces. Received mode "${workspace.mode}".`,
    );
  }

  const provider = await loadProvider('backend');
  const resolvedWorkspace = await provider.resolveWorkspace({
    workspaceRoot: workspace.root,
    config: {},
  });
  const result = await provider.build({
    workspaceRoot: workspace.root,
    env: createWorkspaceRuntimeEnv(workspace.root, 'build', options.env),
    incremental: false,
  });
  const manifest = result.manifest.module;
  if (!manifest) {
    throw new Error('Backend manifest was not produced by the backend build.');
  }

  return {
    workspace,
    buildRoot: resolvedWorkspace.buildRoot,
    manifest,
  };
}
