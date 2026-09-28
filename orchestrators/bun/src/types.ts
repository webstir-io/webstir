import type { ModuleBuildResult, ModuleProvider } from '@webstir-io/module-contract';
import type { WorkspaceLayers } from '@webstir-io/module-contract/workspace';

/** The templates `init` and `refresh` start an app from; nothing records which one was used. */
export const SUPPORTED_STARTERS = ['spa', 'ssg', 'api', 'full'] as const;

export type Starter = (typeof SUPPORTED_STARTERS)[number];
export type CommandMode = 'build' | 'publish';
export type BuildTargetKind = 'frontend' | 'backend';
export type BuildProvider = Pick<ModuleProvider, 'build' | 'resolveWorkspace'>;

export interface WorkspaceDescriptor {
  readonly root: string;
  readonly name: string;
  readonly layers: WorkspaceLayers;
  /** Backend code to compile: the server entry, or functions and jobs without one. */
  readonly backendEntries: boolean;
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
