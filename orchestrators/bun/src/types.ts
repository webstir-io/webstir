import type {
  ModuleBuildResult,
  ModuleProvider,
} from '../../../packages/contracts/module-contract/src/index.ts';

export const SUPPORTED_WORKSPACE_MODES = ['spa', 'ssg', 'api', 'full'] as const;

export type WorkspaceMode = (typeof SUPPORTED_WORKSPACE_MODES)[number];
export type BuildTargetKind = 'frontend' | 'backend';
export type BuildProvider = Pick<ModuleProvider, 'build' | 'resolveWorkspace'>;

export interface WorkspaceDescriptor {
  readonly root: string;
  readonly name: string;
  readonly mode: WorkspaceMode;
}

export interface BuildTargetResult {
  readonly kind: BuildTargetKind;
  readonly buildRoot: string;
  readonly result: ModuleBuildResult;
}

export interface BuildExecutionResult {
  readonly workspace: WorkspaceDescriptor;
  readonly targets: readonly BuildTargetResult[];
}
