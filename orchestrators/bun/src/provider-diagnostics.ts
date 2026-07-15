import type { ModuleBuildResult } from '@webstir-io/module-contract';

import type { BuildTargetKind, CommandMode } from './types.ts';

export type ProviderDiagnosticPhase = CommandMode | 'prebuild' | 'test' | 'inspect';

export function assertNoProviderErrorDiagnostics(
  kind: BuildTargetKind,
  phase: ProviderDiagnosticPhase,
  result: ModuleBuildResult,
): void {
  const errors = result.manifest.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  if (errors.length === 0) {
    return;
  }

  const summary = errors
    .slice(0, 3)
    .map((diagnostic) => diagnostic.message)
    .join(' | ');
  const extra = errors.length > 3 ? ` (+${errors.length - 3} more)` : '';
  throw new Error(
    `${kind} ${phase} reported ${errors.length} error diagnostic(s): ${summary}${extra}`,
  );
}
