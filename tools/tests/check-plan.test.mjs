import { describe, expect, test } from 'bun:test';

import { buildCheckPlan } from '../run-checks.mjs';

describe('buildCheckPlan', () => {
  test('required gate stays deterministic and relies on the orchestrator required suite for watch coverage', () => {
    const plan = buildCheckPlan('required');

    expect(plan.map((step) => step.label)).toEqual([
      'repo biome check',
      'repo biome lint',
      'repo tool contracts',
      'module contract',
      'testing contract',
      'backend tooling tests',
      'backend tooling smoke',
      'frontend tooling tests',
      'testing tooling',
      'testing tooling smoke',
      'bun asset sources',
      'bun feature projections',
      'bun full demo sync',
      'bun orchestrator required suite',
      'bun package install smoke',
      'bun standalone install smoke',
    ]);
    expect(plan.some((step) => step.command.includes('test:watch-browser'))).toBe(false);
  });

  test('with-watch-browser plan remains an alias for the required gate', () => {
    expect(buildCheckPlan('with-watch-browser')).toEqual(buildCheckPlan('required'));
  });
});
