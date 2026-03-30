import type { BackendInspectResult } from './backend-inspect.ts';
import type { DoctorResult } from './doctor.ts';
import type { FrontendInspectResult } from './frontend-inspect.ts';
import type { WorkspaceDescriptor } from './types.ts';

import { runBackendInspect } from './backend-inspect.ts';
import { runDoctor } from './doctor.ts';
import { runFrontendInspect } from './frontend-inspect.ts';

export interface RunInspectOptions {
  readonly workspaceRoot: string;
  readonly env?: Record<string, string | undefined>;
}

export interface InspectStepResult {
  readonly id: 'doctor' | 'frontend-inspect' | 'backend-inspect';
  readonly status: 'completed' | 'skipped' | 'failed';
  readonly summary: string;
}

export interface InspectResult {
  readonly workspace: WorkspaceDescriptor;
  readonly success: boolean;
  readonly steps: readonly InspectStepResult[];
  readonly doctor: DoctorResult;
  readonly frontend?: FrontendInspectResult['frontend'];
  readonly backend?: BackendInspectResult;
}

export async function runInspect(options: RunInspectOptions): Promise<InspectResult> {
  const steps: InspectStepResult[] = [];
  const doctor = await runDoctor({
    workspaceRoot: options.workspaceRoot,
    env: options.env,
  });
  steps.push({
    id: 'doctor',
    status: doctor.healthy ? 'completed' : 'failed',
    summary: doctor.healthy
      ? 'Workspace diagnosis completed without issues.'
      : `Workspace diagnosis found ${doctor.issues.length} issue(s).`,
  });

  let frontendFailed = false;
  let frontend: FrontendInspectResult['frontend'] | undefined;
  if (doctor.workspace.mode === 'api') {
    steps.push({
      id: 'frontend-inspect',
      status: 'skipped',
      summary: 'Skipped for api workspaces.',
    });
  } else {
    try {
      const result = await runFrontendInspect({
        workspaceRoot: options.workspaceRoot,
      });
      frontend = result.frontend;
      steps.push({
        id: 'frontend-inspect',
        status: 'completed',
        summary: `${frontend.pages.length} page(s), app shell ${frontend.appShell.exists ? 'present' : 'missing'}.`,
      });
    } catch (error) {
      frontendFailed = true;
      const message = error instanceof Error ? error.message : String(error);
      steps.push({
        id: 'frontend-inspect',
        status: 'failed',
        summary: `Frontend inspection failed: ${message}`,
      });
    }
  }

  let backendFailed = false;
  let backend: BackendInspectResult | undefined;
  if (doctor.workspace.mode === 'api' || doctor.workspace.mode === 'full') {
    try {
      backend = await runBackendInspect({
        workspaceRoot: options.workspaceRoot,
        env: options.env,
      });
      steps.push({
        id: 'backend-inspect',
        status: 'completed',
        summary: `${backend.manifest.routes?.length ?? 0} route(s), ${backend.manifest.jobs?.length ?? 0} job(s), module ${backend.manifest.name}@${backend.manifest.version}.`,
      });
    } catch (error) {
      backendFailed = true;
      const message = error instanceof Error ? error.message : String(error);
      steps.push({
        id: 'backend-inspect',
        status: 'failed',
        summary: `Backend inspection failed: ${message}`,
      });
    }
  } else {
    steps.push({
      id: 'backend-inspect',
      status: 'skipped',
      summary: `Skipped for ${doctor.workspace.mode} workspaces.`,
    });
  }

  return {
    workspace: doctor.workspace,
    success: doctor.healthy && !frontendFailed && !backendFailed,
    steps,
    doctor,
    ...(frontend ? { frontend } : {}),
    ...(backend ? { backend } : {}),
  };
}
