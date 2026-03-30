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
  if (workspace.mode === 'api') {
    throw new Error(
      `frontend-inspect only supports spa, ssg, and full workspaces. Received mode "${workspace.mode}".`,
    );
  }

  return {
    workspace,
    frontend: await inspectFrontendWorkspace(workspace.root),
  };
}
