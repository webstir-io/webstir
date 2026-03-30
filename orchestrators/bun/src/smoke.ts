import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

import type { WorkspaceDescriptor } from './types.ts';

import { runBackendInspect, type BackendInspectResult } from './backend-inspect.ts';
import { runDoctor, type DoctorResult } from './doctor.ts';
import {
  materializeRepoLocalWorkspaceDependencies,
  prepareExternalWorkspaceCopy,
} from './external-workspace.ts';
import { monorepoRoot } from './paths.ts';
import { runBuild, type RunBuildOptions } from './build.ts';
import { scaffoldWorkspace } from './init.ts';
import { runPublish } from './publish.ts';
import { runTest, type TestCommandResult } from './test.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

export interface RunSmokeOptions {
  readonly workspaceRoot?: string;
  readonly env?: Record<string, string | undefined>;
}

export interface SmokePhaseResult {
  readonly name: 'build' | 'test' | 'publish' | 'doctor' | 'backend-inspect';
  readonly detail: string;
}

export interface SmokeResult {
  readonly workspace: WorkspaceDescriptor;
  readonly phases: readonly SmokePhaseResult[];
  readonly usedTempWorkspace: boolean;
  readonly source?: string;
}

export async function runSmoke(options: RunSmokeOptions = {}): Promise<SmokeResult> {
  const prepared = await prepareWorkspace(options.workspaceRoot);

  try {
    const workspace = await readWorkspaceDescriptor(prepared.workspaceRoot);
    const env = createSmokeEnv(workspace.root, options.env);
    const phases: SmokePhaseResult[] = [];

    const buildResult = await runBuild({
      workspaceRoot: workspace.root,
      env,
    } satisfies RunBuildOptions);
    phases.push({
      name: 'build',
      detail: formatBuildDetail(buildResult),
    });

    const testResult = await runTest({
      workspaceRoot: workspace.root,
      rawArgs: [],
      env,
    });
    if (testResult.hadFailures) {
      throw new Error('Smoke test phase reported failures.');
    }
    phases.push({
      name: 'test',
      detail: formatTestDetail(testResult),
    });

    const publishResult = await runPublish({
      workspaceRoot: workspace.root,
      env,
    });
    phases.push({
      name: 'publish',
      detail: formatBuildDetail(publishResult),
    });

    const doctorResult = await runDoctor({
      workspaceRoot: workspace.root,
      env,
    });
    if (!doctorResult.healthy) {
      throw new Error('Smoke doctor phase reported issues.');
    }
    phases.push({
      name: 'doctor',
      detail: formatDoctorDetail(doctorResult),
    });

    if (workspace.mode === 'api' || workspace.mode === 'full') {
      const backendInspect = await runBackendInspect({
        workspaceRoot: workspace.root,
        env,
      });
      phases.push({
        name: 'backend-inspect',
        detail: formatBackendInspectDetail(backendInspect),
      });
    }

    return {
      workspace,
      phases,
      usedTempWorkspace: prepared.usedTempWorkspace,
      source: prepared.source,
    };
  } finally {
    if (prepared.cleanupRoot) {
      await rm(prepared.cleanupRoot, { recursive: true, force: true });
    }
  }
}

function createSmokeEnv(
  workspaceRoot: string,
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  if (env.WEBSTIR_BACKEND_TYPECHECK) {
    return env;
  }

  const relativeToRepo = monorepoRoot ? path.relative(monorepoRoot, workspaceRoot) : '../external';
  const isExternalWorkspace =
    !monorepoRoot || relativeToRepo.startsWith('..') || path.isAbsolute(relativeToRepo);
  if (!isExternalWorkspace) {
    return env;
  }

  return {
    ...env,
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
  };
}

async function prepareWorkspace(workspaceRoot?: string): Promise<{
  readonly workspaceRoot: string;
  readonly cleanupRoot?: string;
  readonly usedTempWorkspace: boolean;
  readonly source?: string;
}> {
  if (workspaceRoot) {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    const preparedExternalWorkspace = await prepareExternalWorkspaceCopy(
      resolvedWorkspaceRoot,
      'webstir-smoke-explicit-',
      {
        forceLocalPackages: true,
      },
    );
    if (preparedExternalWorkspace) {
      return {
        workspaceRoot: preparedExternalWorkspace.workspaceRoot,
        cleanupRoot: preparedExternalWorkspace.cleanupRoot,
        usedTempWorkspace: false,
      };
    }

    return {
      workspaceRoot: resolvedWorkspaceRoot,
      usedTempWorkspace: false,
    };
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-smoke-'));
  const tempWorkspace = path.join(tempRoot, 'full');
  await scaffoldWorkspace('full', tempWorkspace, { force: true });
  await materializeRepoLocalWorkspaceDependencies(tempWorkspace, {
    forceLocalPackages: true,
  });

  return {
    workspaceRoot: tempWorkspace,
    cleanupRoot: tempRoot,
    usedTempWorkspace: true,
    source: 'built-in full template',
  };
}

function formatBuildDetail(result: Awaited<ReturnType<typeof runBuild>>): string {
  return result.targets
    .map((target) => `${target.kind}:${target.result.artifacts.length} artifacts`)
    .join(', ');
}

function formatTestDetail(result: TestCommandResult): string {
  return `${result.summary.passed} passed, ${result.summary.failed} failed`;
}

function formatBackendInspectDetail(result: BackendInspectResult): string {
  return `${result.manifest.routes?.length ?? 0} routes, ${result.manifest.jobs?.length ?? 0} jobs`;
}

function formatDoctorDetail(result: DoctorResult): string {
  return result.healthy ? 'healthy' : `${result.issues.length} issue(s)`;
}
