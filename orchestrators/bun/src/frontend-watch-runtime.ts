import type { FrontendWatchRuntime, WorkspaceDescriptor } from './types.ts';

export function resolveFrontendWatchRuntime(
  workspace: WorkspaceDescriptor,
  requestedRuntime?: FrontendWatchRuntime
): FrontendWatchRuntime {
  if (requestedRuntime === 'bun') {
    if (workspace.mode === 'spa' || workspace.mode === 'ssg' || workspace.mode === 'full') {
      return 'bun';
    }

    throw new Error(
      `Frontend runtime "bun" currently supports spa, ssg, and full workspaces only. "${workspace.name}" is ${workspace.mode}.`
    );
  }

  if (requestedRuntime === 'legacy') {
    if (workspace.mode === 'ssg') {
      return 'legacy';
    }

    throw new Error(
      `Frontend runtime "legacy" is now supported only for ssg workspaces. "${workspace.name}" is ${workspace.mode}.`
    );
  }

  return 'bun';
}
