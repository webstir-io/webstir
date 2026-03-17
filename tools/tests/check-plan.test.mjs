import { describe, expect, test } from 'bun:test';

import { buildCheckPlan } from '../run-checks.mjs';

describe('buildCheckPlan', () => {
  test('required gate stays deterministic and excludes watch browser coverage', () => {
    const plan = buildCheckPlan('required');

    expect(plan.map((step) => step.label)).toEqual([
      'repo tool contracts',
      'module contract',
      'testing contract',
      'backend tooling tests',
      'backend tooling smoke',
      'frontend tooling tests',
      'frontend tooling smoke',
      'testing tooling',
      'bun asset sources',
      'bun orchestrator required suite',
    ]);
    expect(plan.some((step) => step.command.includes('test:watch-browser'))).toBe(false);
  });

  test('all gate extends the required plan with watch browser coverage', () => {
    const plan = buildCheckPlan('all');

    expect(plan.at(-1)?.label).toBe('bun orchestrator watch browser suite');
    expect(plan.at(-1)?.command).toEqual(['bun', 'run', 'test:watch-browser']);
    expect(plan).toHaveLength(buildCheckPlan('required').length + 1);
  });
});
