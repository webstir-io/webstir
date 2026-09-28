import type { FrontendWorkspaceInspectResult } from '@webstir-io/webstir-frontend';

import { inspectFrontendWorkspace } from '@webstir-io/webstir-frontend';

import type { WorkspaceDescriptor } from './types.ts';

import { readWorkspaceDescriptor } from './workspace.ts';

export interface RunFrontendInspectOptions {
  readonly workspaceRoot: string;
}

export interface FrontendInspectResult {
  readonly workspace: WorkspaceDescriptor;
  readonly frontend: FrontendWorkspaceInspectResult;
}

export async function runFrontendInspect(
  options: RunFrontendInspectOptions,
): Promise<FrontendInspectResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  if (!workspace.layers.pages) {
    throw new Error(`frontend-inspect needs pages, and ${workspace.name} has none (src/frontend).`);
  }

  return {
    workspace,
    frontend: await inspectFrontendWorkspace(workspace.root),
  };
}
