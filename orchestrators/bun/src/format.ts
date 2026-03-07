import type { BuildExecutionResult } from './types.ts';

export function formatBuildSummary(result: BuildExecutionResult): string {
  const lines = [
    '[webstir-bun] build complete',
    `workspace: ${result.workspace.name}`,
    `mode: ${result.workspace.mode}`,
    `root: ${result.workspace.root}`,
  ];

  for (const target of result.targets) {
    const diagnostics = summarizeDiagnostics(target.result);
    lines.push(
      `${target.kind}: ${target.result.artifacts.length} artifacts, ` +
        `${target.result.manifest.entryPoints.length} entries, ` +
        `${target.result.manifest.staticAssets.length} static assets -> ${target.buildRoot}`
    );

    if (diagnostics.errors > 0 || diagnostics.warnings > 0) {
      lines.push(
        `${target.kind}: ${diagnostics.errors} error(s), ${diagnostics.warnings} warning(s), ${diagnostics.info} info`
      );
    }
  }

  return lines.join('\n');
}

function summarizeDiagnostics(result: BuildExecutionResult['targets'][number]['result']) {
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
