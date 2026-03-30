import type { AgentResult } from './agent.ts';
import type { EnableResult } from './enable.ts';
import type { DoctorResult } from './doctor.ts';
import type { InitResult } from './init.ts';
import type { WebstirOperationDescriptor } from './operations.ts';
import type { RefreshResult } from './refresh.ts';
import type { RepairResult } from './repair.ts';
import type { BackendInspectResult } from './backend-inspect.ts';
import type { SmokeResult } from './smoke.ts';
import type { TestCommandResult } from './test.ts';
import type { CommandExecutionResult } from './types.ts';

export function formatBuildSummary(result: CommandExecutionResult): string {
  return formatExecutionSummary(result);
}

export function formatPublishSummary(result: CommandExecutionResult): string {
  return formatExecutionSummary(result);
}

export function formatEnableSummary(result: EnableResult): string {
  const lines = [
    '[webstir] enable complete',
    `feature: ${result.feature}`,
    `root: ${result.workspaceRoot}`,
  ];

  if (result.changes.length === 0) {
    lines.push('changes: none');
    return lines.join('\n');
  }

  lines.push(`changes: ${result.changes.length}`);
  for (const change of result.changes) {
    lines.push(`  - ${change}`);
  }

  return lines.join('\n');
}

export function formatInitSummary(result: InitResult): string {
  return formatWorkspaceMutationSummary(
    '[webstir] init complete',
    result.mode,
    result.workspaceRoot,
    result.changes,
  );
}

export function formatRefreshSummary(result: RefreshResult): string {
  return formatWorkspaceMutationSummary(
    '[webstir] refresh complete',
    result.mode,
    result.workspaceRoot,
    result.changes,
  );
}

export function formatRepairSummary(result: RepairResult): string {
  const lines = [
    '[webstir] repair complete',
    `mode: ${result.mode}`,
    `root: ${result.workspaceRoot}`,
    `dry-run: ${result.dryRun ? 'true' : 'false'}`,
  ];

  if (result.changes.length === 0) {
    lines.push('changes: none');
    return lines.join('\n');
  }

  lines.push(`changes: ${result.changes.length}`);
  for (const change of result.changes) {
    lines.push(`  - ${change}`);
  }

  return lines.join('\n');
}

export function formatRepairJson(result: RepairResult): string {
  return JSON.stringify(
    {
      command: 'repair',
      workspaceRoot: result.workspaceRoot,
      mode: result.mode,
      dryRun: result.dryRun,
      changes: result.changes,
    },
    null,
    2,
  );
}

export function formatOperationsSummary(operations: readonly WebstirOperationDescriptor[]): string {
  const lines = ['[webstir] operations', `count: ${operations.length}`];

  for (const operation of operations) {
    const details = [
      operation.requiresWorkspace ? 'workspace' : 'no-workspace',
      operation.mutatesWorkspace ? 'mutates' : 'read-only',
      operation.supportsJson ? 'json' : 'text',
      operation.stableForMcp ? 'mcp-ready' : 'manual-only',
      operation.workspaceModes ? `modes: ${operation.workspaceModes.join(', ')}` : undefined,
    ].filter(Boolean);
    lines.push(
      `  - ${operation.id}: ${operation.summary}${details.length > 0 ? ` (${details.join(', ')})` : ''}`,
    );
  }

  return lines.join('\n');
}

export function formatOperationsJson(operations: readonly WebstirOperationDescriptor[]): string {
  return JSON.stringify(
    {
      command: 'operations',
      operations,
    },
    null,
    2,
  );
}

export function formatDoctorSummary(result: DoctorResult): string {
  const lines = [
    '[webstir] doctor complete',
    `workspace: ${result.workspace.name}`,
    `mode: ${result.workspace.mode}`,
    `root: ${result.workspace.root}`,
    `healthy: ${result.healthy ? 'true' : 'false'}`,
  ];

  lines.push(`checks: ${result.checks.length}`);
  for (const check of result.checks) {
    lines.push(`  - ${check.id}: ${check.status} (${check.summary})`);
    if (check.detail) {
      lines.push(`    detail: ${check.detail}`);
    }
  }

  if (result.issues.length === 0) {
    lines.push('issues: none');
  } else {
    lines.push(`issues: ${result.issues.length}`);
    for (const issue of result.issues) {
      lines.push(`  - ${issue.code}: ${issue.message}`);
      if (issue.changes && issue.changes.length > 0) {
        for (const change of issue.changes) {
          lines.push(`    change: ${change}`);
        }
      }
    }
  }

  if (result.repair.changes.length > 0) {
    lines.push(`repair: webstir ${result.repair.command} ${result.repair.args.join(' ')}`);
  }

  return lines.join('\n');
}

export function formatDoctorJson(result: DoctorResult): string {
  return JSON.stringify(
    {
      command: 'doctor',
      workspace: {
        name: result.workspace.name,
        mode: result.workspace.mode,
        root: result.workspace.root,
      },
      healthy: result.healthy,
      checks: result.checks,
      issues: result.issues,
      repair: result.repair,
      ...(result.backend ? { backend: result.backend } : {}),
    },
    null,
    2,
  );
}

export function formatAgentSummary(result: AgentResult): string {
  const lines = [
    '[webstir] agent complete',
    `goal: ${result.goal}`,
    `root: ${result.workspaceRoot}`,
    `success: ${result.success ? 'true' : 'false'}`,
    `steps: ${result.steps.length}`,
  ];

  for (const step of result.steps) {
    lines.push(`  - ${step.id}: ${step.status} (${step.summary})`);
  }

  return lines.join('\n');
}

export function formatAgentJson(result: AgentResult): string {
  return JSON.stringify(
    {
      command: 'agent',
      ...result,
    },
    null,
    2,
  );
}

export function formatBackendInspectSummary(result: BackendInspectResult): string {
  const lines = [
    '[webstir] backend-inspect complete',
    `workspace: ${result.workspace.name}`,
    `mode: ${result.workspace.mode}`,
    `root: ${result.workspace.root}`,
    `build: ${result.buildRoot}`,
    `module: ${result.manifest.name}@${result.manifest.version}`,
    `capabilities: ${result.manifest.capabilities && result.manifest.capabilities.length > 0 ? result.manifest.capabilities.join(', ') : 'none'}`,
  ];

  const routes = result.manifest.routes ?? [];
  lines.push(`routes: ${routes.length}`);
  for (const route of routes) {
    lines.push(`  - ${route.method} ${route.path}${route.name ? ` (${route.name})` : ''}`);
  }

  const views = result.manifest.views ?? [];
  lines.push(`views: ${views.length}`);
  for (const view of views) {
    lines.push(`  - ${view.path}${view.name ? ` (${view.name})` : ''}`);
  }

  const jobs = result.manifest.jobs ?? [];
  lines.push(`jobs: ${jobs.length}`);
  for (const job of jobs) {
    const details = [
      job.schedule ? `schedule: ${job.schedule}` : undefined,
      'description' in job && typeof (job as { description?: unknown }).description === 'string'
        ? `description: ${(job as { description?: string }).description}`
        : undefined,
      job.priority !== undefined ? `priority: ${String(job.priority)}` : undefined,
    ].filter(Boolean);
    lines.push(`  - ${job.name}${details.length > 0 ? ` (${details.join(', ')})` : ''}`);
  }

  return lines.join('\n');
}

export function formatBackendInspectJson(result: BackendInspectResult): string {
  return JSON.stringify(
    {
      command: 'backend-inspect',
      workspace: {
        name: result.workspace.name,
        mode: result.workspace.mode,
        root: result.workspace.root,
      },
      buildRoot: result.buildRoot,
      manifest: result.manifest,
    },
    null,
    2,
  );
}

export function formatTestSummary(result: TestCommandResult): string {
  const lines = [
    '[webstir] test complete',
    `workspace: ${result.workspace.name}`,
    `mode: ${result.workspace.mode}`,
    `root: ${result.workspace.root}`,
    `runtime: ${result.runtime}`,
    `build-targets: ${result.builtTargets.length > 0 ? result.builtTargets.join(', ') : 'none'}`,
  ];

  if (result.filterMessage) {
    lines.push(`filter: ${result.filterMessage}`);
  }

  lines.push(`tests: ${result.summary.total}`);
  lines.push(`passed: ${result.summary.passed}`);
  lines.push(`failed: ${result.summary.failed}`);
  lines.push(`durationMs: ${result.summary.durationMs}`);

  const failures = formatFailedTests(result.summary.results);
  if (failures.length > 0) {
    lines.push(`failures: ${failures.length}`);
    for (const failure of failures) {
      lines.push(`  - ${failure}`);
    }
  }

  return lines.join('\n');
}

export function formatSmokeSummary(result: SmokeResult): string {
  const lines = [
    '[webstir] smoke complete',
    `workspace: ${result.workspace.name}`,
    `mode: ${result.workspace.mode}`,
    `root: ${result.workspace.root}`,
    `workspace-source: ${result.usedTempWorkspace ? 'temporary copy' : 'explicit workspace'}`,
  ];

  if (result.source) {
    lines.push(`source: ${result.source}`);
  }

  lines.push(`phases: ${result.phases.length}`);
  for (const phase of result.phases) {
    lines.push(`  - ${phase.name}: ${phase.detail}`);
  }

  return lines.join('\n');
}

export function formatAddSummary(
  header: string,
  target: string,
  workspaceRoot: string,
  changes: readonly string[],
  note?: string,
): string {
  const lines = [header, `target: ${target}`, `root: ${workspaceRoot}`];

  if (changes.length === 0) {
    lines.push('changes: none');
    if (note) {
      lines.push(`note: ${note}`);
    }
    return lines.join('\n');
  }

  lines.push(`changes: ${changes.length}`);
  for (const change of changes) {
    lines.push(`  - ${change}`);
  }

  if (note) {
    lines.push(`note: ${note}`);
  }

  return lines.join('\n');
}

function formatExecutionSummary(result: CommandExecutionResult): string {
  const lines = [
    `[webstir] ${result.mode} complete`,
    `workspace: ${result.workspace.name}`,
    `mode: ${result.workspace.mode}`,
    `root: ${result.workspace.root}`,
  ];

  for (const target of result.targets) {
    const diagnostics = summarizeDiagnostics(target.result);
    lines.push(
      `${target.kind}: ${target.result.artifacts.length} artifacts, ` +
        `${target.result.manifest.entryPoints.length} entries, ` +
        `${target.result.manifest.staticAssets.length} static assets -> ${target.outputRoot}`,
    );

    if (diagnostics.errors > 0 || diagnostics.warnings > 0) {
      lines.push(
        `${target.kind}: ${diagnostics.errors} error(s), ${diagnostics.warnings} warning(s), ${diagnostics.info} info`,
      );
    }
  }

  return lines.join('\n');
}

function formatFailedTests(
  results: readonly {
    readonly passed: boolean;
    readonly file: string;
    readonly name: string;
    readonly message?: string | null;
  }[],
): string[] {
  return results
    .filter((result) => !result.passed)
    .map(
      (result) =>
        `${result.file}: ${result.name}${result.message ? ` — ${firstLine(result.message)}` : ''}`,
    );
}

function firstLine(message: string): string {
  return message.split(/\r?\n/, 1)[0] ?? message;
}

function formatWorkspaceMutationSummary(
  header: string,
  mode: string,
  workspaceRoot: string,
  changes: readonly string[],
): string {
  const lines = [header, `mode: ${mode}`, `root: ${workspaceRoot}`];

  if (changes.length === 0) {
    lines.push('changes: none');
    return lines.join('\n');
  }

  lines.push(`changes: ${changes.length}`);
  for (const change of changes) {
    lines.push(`  - ${change}`);
  }

  return lines.join('\n');
}

function summarizeDiagnostics(result: CommandExecutionResult['targets'][number]['result']) {
  const counts = {
    errors: 0,
    warnings: 0,
    info: 0,
  };

  for (const diagnostic of result.manifest.diagnostics) {
    if (diagnostic.severity === 'error') {
      counts.errors += 1;
    } else if (diagnostic.severity === 'warn') {
      counts.warnings += 1;
    } else {
      counts.info += 1;
    }
  }

  return counts;
}
