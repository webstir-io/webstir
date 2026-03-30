import type { AddCommandResult } from './add.ts';
import type { BackendInspectResult } from './backend-inspect.ts';
import type { DoctorResult } from './doctor.ts';
import type { RepairResult } from './repair.ts';
import type { TestCommandResult } from './test.ts';

import { runAddPageCommand } from './add.ts';
import { runAddJobCommand, runAddRouteCommand } from './add-backend.ts';
import { runBackendInspect } from './backend-inspect.ts';
import { runDoctor } from './doctor.ts';
import { runRepair } from './repair.ts';
import { runTest } from './test.ts';

export type AgentGoal =
  | 'inspect'
  | 'validate'
  | 'repair'
  | 'scaffold-page'
  | 'scaffold-route'
  | 'scaffold-job';

export interface RunAgentOptions {
  readonly workspaceRoot: string;
  readonly goal: AgentGoal;
  readonly rawArgs: readonly string[];
  readonly positionals: readonly string[];
  readonly env?: Record<string, string | undefined>;
}

export interface AgentStepResult {
  readonly id:
    | 'doctor'
    | 'backend-inspect'
    | 'test'
    | 'repair'
    | 'add-page'
    | 'add-route'
    | 'add-job';
  readonly status: 'completed' | 'skipped' | 'failed';
  readonly summary: string;
}

export interface AgentResult {
  readonly workspaceRoot: string;
  readonly goal: AgentGoal;
  readonly success: boolean;
  readonly steps: readonly AgentStepResult[];
  readonly doctor?: DoctorResult;
  readonly inspect?: BackendInspectResult;
  readonly repair?: RepairResult;
  readonly test?: Pick<TestCommandResult, 'runtime' | 'builtTargets' | 'summary' | 'hadFailures'>;
  readonly scaffold?: Pick<AddCommandResult, 'subject' | 'target' | 'changes' | 'note'>;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const steps: AgentStepResult[] = [];

  if (options.goal === 'inspect') {
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

    const backendSupported = doctor.workspace.mode === 'api' || doctor.workspace.mode === 'full';
    let inspectFailed = false;
    let inspect: BackendInspectResult | undefined;
    if (backendSupported) {
      try {
        inspect = await runBackendInspect({
          workspaceRoot: options.workspaceRoot,
          env: options.env,
        });
        steps.push({
          id: 'backend-inspect',
          status: 'completed',
          summary: `${inspect.manifest.routes?.length ?? 0} route(s), ${inspect.manifest.jobs?.length ?? 0} job(s), module ${inspect.manifest.name}@${inspect.manifest.version}.`,
        });
      } catch (error) {
        inspectFailed = true;
        const message = error instanceof Error ? error.message : String(error);
        steps.push({
          id: 'backend-inspect',
          status: 'failed',
          summary: `Backend inspection failed: ${message}`,
        });
      }
    }

    return {
      workspaceRoot: options.workspaceRoot,
      goal: options.goal,
      success: doctor.healthy && !inspectFailed,
      steps,
      doctor,
      ...(inspect ? { inspect } : {}),
    };
  }

  if (options.goal === 'validate') {
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

    if (!doctor.healthy) {
      steps.push({
        id: 'test',
        status: 'skipped',
        summary: 'Skipped tests because diagnosis reported issues first.',
      });
      return {
        workspaceRoot: options.workspaceRoot,
        goal: options.goal,
        success: false,
        steps,
        doctor,
      };
    }

    const test = await runTest({
      workspaceRoot: options.workspaceRoot,
      rawArgs: [],
      env: options.env,
      quietInstall: true,
    });
    steps.push({
      id: 'test',
      status: test.hadFailures ? 'failed' : 'completed',
      summary: `${test.summary.passed} passed, ${test.summary.failed} failed.`,
    });

    return {
      workspaceRoot: options.workspaceRoot,
      goal: options.goal,
      success: !test.hadFailures,
      steps,
      doctor,
      test: {
        runtime: test.runtime,
        builtTargets: test.builtTargets,
        summary: test.summary,
        hadFailures: test.hadFailures,
      },
    };
  }

  if (options.goal === 'repair') {
    const initialDoctor = await runDoctor({
      workspaceRoot: options.workspaceRoot,
      env: options.env,
    });
    steps.push({
      id: 'doctor',
      status: initialDoctor.healthy ? 'completed' : 'failed',
      summary: initialDoctor.healthy
        ? 'Workspace diagnosis completed without issues.'
        : `Workspace diagnosis found ${initialDoctor.issues.length} issue(s).`,
    });

    if (initialDoctor.healthy) {
      steps.push({
        id: 'repair',
        status: 'skipped',
        summary: 'Skipped repair because the workspace is already healthy.',
      });
      return {
        workspaceRoot: options.workspaceRoot,
        goal: options.goal,
        success: true,
        steps,
        doctor: initialDoctor,
      };
    }

    if (initialDoctor.repair.changes.length === 0) {
      steps.push({
        id: 'repair',
        status: 'skipped',
        summary: 'No scaffold-managed repair action was available for the reported issues.',
      });
      return {
        workspaceRoot: options.workspaceRoot,
        goal: options.goal,
        success: false,
        steps,
        doctor: initialDoctor,
      };
    }

    const repair = await runRepair({
      workspaceRoot: options.workspaceRoot,
      rawArgs: [],
    });
    steps.push({
      id: 'repair',
      status: 'completed',
      summary: `Applied ${repair.changes.length} scaffold-managed change(s).`,
    });

    const finalDoctor = await runDoctor({
      workspaceRoot: options.workspaceRoot,
      env: options.env,
    });
    steps.push({
      id: 'doctor',
      status: finalDoctor.healthy ? 'completed' : 'failed',
      summary: finalDoctor.healthy
        ? 'Workspace diagnosis passed after repair.'
        : `Workspace still has ${finalDoctor.issues.length} issue(s) after repair.`,
    });

    return {
      workspaceRoot: options.workspaceRoot,
      goal: options.goal,
      success: finalDoctor.healthy,
      steps,
      doctor: finalDoctor,
      repair,
    };
  }

  if (options.goal === 'scaffold-page') {
    const scaffold = await runAddPageCommand({
      workspaceRoot: options.workspaceRoot,
      args: options.positionals.slice(1),
    });
    steps.push({
      id: 'add-page',
      status: 'completed',
      summary: `Scaffolded page ${scaffold.target}.`,
    });

    const doctor = await runDoctor({
      workspaceRoot: options.workspaceRoot,
      env: options.env,
    });
    steps.push({
      id: 'doctor',
      status: doctor.healthy ? 'completed' : 'failed',
      summary: doctor.healthy
        ? 'Workspace remains healthy after page scaffolding.'
        : `Workspace diagnosis found ${doctor.issues.length} issue(s) after scaffolding.`,
    });

    return {
      workspaceRoot: options.workspaceRoot,
      goal: options.goal,
      success: doctor.healthy,
      steps,
      doctor,
      scaffold,
    };
  }

  if (options.goal === 'scaffold-route') {
    const scaffold = await runAddRouteCommand({
      workspaceRoot: options.workspaceRoot,
      rawArgs: stripGoalFromRawArgs(options.rawArgs, options.goal),
    });
    steps.push({
      id: 'add-route',
      status: 'completed',
      summary: `Scaffolded route ${scaffold.target}.`,
    });

    const inspect = await runBackendInspect({
      workspaceRoot: options.workspaceRoot,
      env: options.env,
    });
    steps.push({
      id: 'backend-inspect',
      status: 'completed',
      summary: `${inspect.manifest.routes?.length ?? 0} route(s), ${inspect.manifest.jobs?.length ?? 0} job(s), module ${inspect.manifest.name}@${inspect.manifest.version}.`,
    });

    return {
      workspaceRoot: options.workspaceRoot,
      goal: options.goal,
      success: true,
      steps,
      inspect,
      scaffold,
    };
  }

  const scaffold = await runAddJobCommand({
    workspaceRoot: options.workspaceRoot,
    rawArgs: stripGoalFromRawArgs(options.rawArgs, options.goal),
  });
  steps.push({
    id: 'add-job',
    status: 'completed',
    summary: `Scaffolded job ${scaffold.target}.`,
  });

  const inspect = await runBackendInspect({
    workspaceRoot: options.workspaceRoot,
    env: options.env,
  });
  steps.push({
    id: 'backend-inspect',
    status: 'completed',
    summary: `${inspect.manifest.routes?.length ?? 0} route(s), ${inspect.manifest.jobs?.length ?? 0} job(s), module ${inspect.manifest.name}@${inspect.manifest.version}.`,
  });

  return {
    workspaceRoot: options.workspaceRoot,
    goal: options.goal,
    success: true,
    steps,
    inspect,
    scaffold,
  };
}

function stripGoalFromRawArgs(rawArgs: readonly string[], goal: AgentGoal): string[] {
  const next = [...rawArgs];
  const goalIndex = next.indexOf(goal);
  if (goalIndex >= 0) {
    next.splice(goalIndex, 1);
  }
  const jsonIndex = next.indexOf('--json');
  if (jsonIndex >= 0) {
    next.splice(jsonIndex, 1);
  }
  return next;
}
