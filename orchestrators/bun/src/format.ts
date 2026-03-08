import type { EnableResult } from './enable.ts';
import type { InitResult } from './init.ts';
import type { RefreshResult } from './refresh.ts';
import type { CommandExecutionResult } from './types.ts';

export function formatBuildSummary(result: CommandExecutionResult): string {
  return formatExecutionSummary(result);
}

export function formatPublishSummary(result: CommandExecutionResult): string {
  return formatExecutionSummary(result);
}

export function formatEnableSummary(result: EnableResult): string {
  const lines = [
    '[webstir-bun] enable complete',
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
  return formatWorkspaceMutationSummary('[webstir-bun] init complete', result.mode, result.workspaceRoot, result.changes);
}

export function formatRefreshSummary(result: RefreshResult): string {
  return formatWorkspaceMutationSummary('[webstir-bun] refresh complete', result.mode, result.workspaceRoot, result.changes);
}

function formatExecutionSummary(result: CommandExecutionResult): string {
  const lines = [
    `[webstir-bun] ${result.mode} complete`,
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
