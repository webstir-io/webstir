import type { BuildTargetKind, WorkspaceMode } from './types.ts';

const BUILD_PLANS = {
  spa: ['frontend'],
  ssg: ['frontend'],
  api: ['backend'],
  full: ['frontend', 'backend'],
} as const satisfies Record<WorkspaceMode, readonly BuildTargetKind[]>;

export function createBuildPlan(mode: WorkspaceMode): readonly BuildTargetKind[] {
  return BUILD_PLANS[mode];
}
