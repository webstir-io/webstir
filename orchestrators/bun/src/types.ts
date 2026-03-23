import type { ModuleBuildResult, ModuleProvider } from '@webstir-io/module-contract';

export const SUPPORTED_WORKSPACE_MODES = ['spa', 'ssg', 'api', 'full'] as const;

export type WorkspaceMode = (typeof SUPPORTED_WORKSPACE_MODES)[number];
export type CommandMode = 'build' | 'publish';
export type BuildTargetKind = 'frontend' | 'backend';
export type BuildProvider = Pick<ModuleProvider, 'build' | 'resolveWorkspace'>;

export interface WorkspaceDescriptor {
  readonly root: string;
  readonly name: string;
  readonly mode: WorkspaceMode;
}

export interface CommandTargetResult {
  readonly kind: BuildTargetKind;
  readonly outputRoot: string;
  readonly result: ModuleBuildResult;
}

export interface CommandExecutionResult {
  readonly mode: CommandMode;
  readonly workspace: WorkspaceDescriptor;
  readonly targets: readonly CommandTargetResult[];
}
