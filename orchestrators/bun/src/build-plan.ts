import type { WorkspaceLayers } from '@webstir-io/module-contract/workspace';

import type { BuildTargetKind } from './types.ts';

export function createBuildPlan(layers: WorkspaceLayers): readonly BuildTargetKind[] {
  return [
    ...(layers.pages ? (['frontend'] as const) : []),
    ...(layers.server ? (['backend'] as const) : []),
  ];
}
