import type { EnableResult } from './enable.ts';
import type { InitResult } from './init.ts';
import type { RefreshResult } from './refresh.ts';
import type { RepairResult } from './repair.ts';
import type { BackendInspectResult } from './backend-inspect.ts';
import type { SmokeResult } from './smoke.ts';
import type { TestCommandResult } from './test.ts';
import { formatFailedTests } from './test.ts';
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
  return formatWorkspaceMutationSummary('[webstir] init complete', result.mode, result.workspaceRoot, result.changes);
}

export function formatRefreshSummary(result: RefreshResult): string {
  return formatWorkspaceMutationSummary('[webstir] refresh complete', result.mode, result.workspaceRoot, result.changes);
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
  note?: string
): string {
  const lines = [
    header,
    `target: ${target}`,
    `root: ${workspaceRoot}`,
  ];

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
        `${target.result.manifest.staticAssets.length} static assets -> ${target.outputRoot}`
    );

    if (diagnostics.errors > 0 || diagnostics.warnings > 0) {
      lines.push(
        `${target.kind}: ${diagnostics.errors} error(s), ${diagnostics.warnings} warning(s), ${diagnostics.info} info`
      );
    }
  }

  return lines.join('\n');
}

function formatWorkspaceMutationSummary(
  header: string,
  mode: string,
  workspaceRoot: string,
  changes: readonly string[]
): string {
  const lines = [
    header,
    `mode: ${mode}`,
    `root: ${workspaceRoot}`,
  ];

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
