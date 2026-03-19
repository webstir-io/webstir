import type { FrontendWatchRuntime, WorkspaceDescriptor } from './types.ts';

export function resolveFrontendWatchRuntime(
  workspace: WorkspaceDescriptor,
  requestedRuntime?: FrontendWatchRuntime
): FrontendWatchRuntime {
  if (requestedRuntime === 'bun' && workspace.mode !== 'spa') {
    throw new Error(
      `Frontend runtime "bun" currently supports spa workspaces only. "${workspace.name}" is ${workspace.mode}.`
    );
  }

  if (requestedRuntime) {
    return requestedRuntime;
  }

  return workspace.mode === 'spa' ? 'bun' : 'legacy';
}
