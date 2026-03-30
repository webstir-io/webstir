import type { WorkspaceMode } from './types.ts';

export interface WebstirOperationDescriptor {
  readonly id:
    | 'init'
    | 'refresh'
    | 'doctor'
    | 'repair'
    | 'enable'
    | 'add-page'
    | 'add-test'
    | 'add-route'
    | 'add-job'
    | 'backend-inspect'
    | 'build'
    | 'publish'
    | 'watch'
    | 'test'
    | 'smoke';
  readonly summary: string;
  readonly requiresWorkspace: boolean;
  readonly mutatesWorkspace: boolean;
  readonly supportsJson: boolean;
  readonly stableForMcp: boolean;
  readonly workspaceModes?: readonly WorkspaceMode[];
}

const OPERATIONS: readonly WebstirOperationDescriptor[] = [
  {
    id: 'init',
    summary: 'Scaffold a new workspace for the supported Webstir modes.',
    requiresWorkspace: false,
    mutatesWorkspace: true,
    supportsJson: false,
    stableForMcp: true,
  },
  {
    id: 'refresh',
    summary: 'Reset and re-scaffold an existing workspace directory.',
    requiresWorkspace: true,
    mutatesWorkspace: true,
    supportsJson: false,
    stableForMcp: false,
  },
  {
    id: 'doctor',
    summary: 'Diagnose scaffold drift and backend manifest health.',
    requiresWorkspace: true,
    mutatesWorkspace: false,
    supportsJson: true,
    stableForMcp: true,
  },
  {
    id: 'repair',
    summary: 'Restore missing scaffold-managed files and wiring.',
    requiresWorkspace: true,
    mutatesWorkspace: true,
    supportsJson: true,
    stableForMcp: true,
  },
  {
    id: 'enable',
    summary: 'Opt into an optional framework feature.',
    requiresWorkspace: true,
    mutatesWorkspace: true,
    supportsJson: false,
    stableForMcp: false,
  },
  {
    id: 'add-page',
    summary: 'Scaffold a frontend document page.',
    requiresWorkspace: true,
    mutatesWorkspace: true,
    supportsJson: false,
    stableForMcp: true,
    workspaceModes: ['spa', 'ssg', 'full'],
  },
  {
    id: 'add-test',
    summary: 'Scaffold a frontend or backend test file.',
    requiresWorkspace: true,
    mutatesWorkspace: true,
    supportsJson: false,
    stableForMcp: true,
  },
  {
    id: 'add-route',
    summary: 'Record a backend route contract in the module manifest.',
    requiresWorkspace: true,
    mutatesWorkspace: true,
    supportsJson: false,
    stableForMcp: true,
    workspaceModes: ['api', 'full'],
  },
  {
    id: 'add-job',
    summary: 'Scaffold a backend job and record it in the module manifest.',
    requiresWorkspace: true,
    mutatesWorkspace: true,
    supportsJson: false,
    stableForMcp: true,
    workspaceModes: ['api', 'full'],
  },
  {
    id: 'backend-inspect',
    summary: 'Build the backend and emit manifest metadata for routes and jobs.',
    requiresWorkspace: true,
    mutatesWorkspace: false,
    supportsJson: true,
    stableForMcp: true,
    workspaceModes: ['api', 'full'],
  },
  {
    id: 'build',
    summary: 'Build the current workspace through the canonical providers.',
    requiresWorkspace: true,
    mutatesWorkspace: false,
    supportsJson: false,
    stableForMcp: true,
  },
  {
    id: 'publish',
    summary: 'Produce publish-ready artifacts for the current workspace.',
    requiresWorkspace: true,
    mutatesWorkspace: false,
    supportsJson: false,
    stableForMcp: true,
  },
  {
    id: 'watch',
    summary: 'Run the long-lived development loop.',
    requiresWorkspace: true,
    mutatesWorkspace: false,
    supportsJson: false,
    stableForMcp: false,
  },
  {
    id: 'test',
    summary: 'Build and run frontend and or backend tests for the workspace.',
    requiresWorkspace: true,
    mutatesWorkspace: false,
    supportsJson: false,
    stableForMcp: true,
  },
  {
    id: 'smoke',
    summary: 'Run the bounded end-to-end verification flow.',
    requiresWorkspace: false,
    mutatesWorkspace: false,
    supportsJson: false,
    stableForMcp: true,
  },
] as const;

export function listOperations(): readonly WebstirOperationDescriptor[] {
  return OPERATIONS;
}
