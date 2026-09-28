import type { BuildTargetKind, WorkspaceDescriptor } from './types.ts';

/** Pages build the frontend; a server, or functions and jobs without one, build the backend. */
export function createBuildPlan(
  workspace: Pick<WorkspaceDescriptor, 'layers' | 'backendEntries'>,
): readonly BuildTargetKind[] {
  return [
    ...(workspace.layers.pages ? (['frontend'] as const) : []),
    ...(workspace.backendEntries ? (['backend'] as const) : []),
  ];
}
