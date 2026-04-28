import type { BackendInspectResult } from './backend-inspect.ts';
import type { WorkspaceDescriptor } from './types.ts';

import { runBackendInspect } from './backend-inspect.ts';
import { runRepair } from './repair.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

export interface RunDoctorOptions {
  readonly workspaceRoot: string;
  readonly env?: Record<string, string | undefined>;
}

export interface DoctorCheck {
  readonly id: 'scaffold' | 'backend-inspect';
  readonly status: 'pass' | 'fail' | 'skip';
  readonly summary: string;
  readonly detail?: string;
  readonly changes?: readonly string[];
}

export interface DoctorIssue {
  readonly code: 'scaffold_drift' | 'backend_inspect_failed';
  readonly severity: 'error';
  readonly message: string;
  readonly repairable: boolean;
  readonly changes?: readonly string[];
}

export interface DoctorRepairPlan {
  readonly command: 'repair';
  readonly args: readonly string[];
  readonly changes: readonly string[];
}

export interface DoctorBackendSummary {
  readonly buildRoot: string;
  readonly module: string;
  readonly routes: number;
  readonly jobs: number;
  readonly data: DoctorBackendDataSummary;
}

export interface DoctorBackendDataSummary {
  readonly migrations: DoctorBackendMigrationSummary;
}

export interface DoctorBackendMigrationSummary {
  readonly runnerPresent: boolean;
  readonly migrationsDirectoryPresent: boolean;
  readonly migrationFilesCount: number;
  readonly exampleMigrationPresent: boolean;
  readonly tableEnvKey: string;
  readonly configuredTable: string;
}

export interface DoctorResult {
  readonly workspace: WorkspaceDescriptor;
  readonly healthy: boolean;
  readonly checks: readonly DoctorCheck[];
  readonly issues: readonly DoctorIssue[];
  readonly repair: DoctorRepairPlan;
  readonly backend?: DoctorBackendSummary;
}

export async function runDoctor(options: RunDoctorOptions): Promise<DoctorResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  const checks: DoctorCheck[] = [];
  const issues: DoctorIssue[] = [];

  const repairResult = await runRepair({
    workspaceRoot: workspace.root,
    rawArgs: ['--dry-run'],
  });

  if (repairResult.changes.length > 0) {
    checks.push({
      id: 'scaffold',
      status: 'fail',
      summary: `${repairResult.changes.length} scaffold-managed change(s) required.`,
      changes: repairResult.changes,
    });
    issues.push({
      code: 'scaffold_drift',
      severity: 'error',
      message: 'Scaffold-managed files or wiring have drifted from the expected workspace shape.',
      repairable: true,
      changes: repairResult.changes,
    });
  } else {
    checks.push({
      id: 'scaffold',
      status: 'pass',
      summary: 'Scaffold-managed files and wiring match the expected workspace shape.',
    });
  }

  let backend: DoctorBackendSummary | undefined;
  if (workspace.mode === 'api' || workspace.mode === 'full') {
    try {
      const inspectResult = await runBackendInspect({
        workspaceRoot: workspace.root,
        env: options.env,
      });
      backend = summarizeBackendInspect(inspectResult);
      checks.push({
        id: 'backend-inspect',
        status: 'pass',
        summary: `${backend.routes} route(s), ${backend.jobs} job(s), module ${backend.module}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      checks.push({
        id: 'backend-inspect',
        status: 'fail',
        summary: 'Backend inspect failed.',
        detail: message,
      });
      issues.push({
        code: 'backend_inspect_failed',
        severity: 'error',
        message: `Backend inspect failed: ${message}`,
        repairable: false,
      });
    }
  } else {
    checks.push({
      id: 'backend-inspect',
      status: 'skip',
      summary: `Skipped for ${workspace.mode} workspaces.`,
    });
  }

  return {
    workspace,
    healthy: issues.length === 0,
    checks,
    issues,
    repair: {
      command: 'repair',
      args: ['--workspace', workspace.root],
      changes: repairResult.changes,
    },
    ...(backend ? { backend } : {}),
  };
}

function summarizeBackendInspect(result: BackendInspectResult): DoctorBackendSummary {
  return {
    buildRoot: result.buildRoot,
    module: `${result.manifest.name}@${result.manifest.version}`,
    routes: result.manifest.routes?.length ?? 0,
    jobs: result.manifest.jobs?.length ?? 0,
    data: {
      migrations: {
        runnerPresent: result.data.migrations.runnerPresent,
        migrationsDirectoryPresent: result.data.migrations.migrationsDirectoryPresent,
        migrationFilesCount: result.data.migrations.migrationFilesCount,
        exampleMigrationPresent: result.data.migrations.exampleMigrationPresent,
        tableEnvKey: result.data.migrations.tableEnvKey,
        configuredTable: result.data.migrations.configuredTable,
      },
    },
  };
}
