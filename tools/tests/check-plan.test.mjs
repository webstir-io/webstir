import { describe, expect, test } from 'bun:test';

import { buildCheckPlan } from '../run-checks.mjs';

describe('buildCheckPlan', () => {
  test('required gate builds the framework graph once before testing built output', () => {
    const plan = buildCheckPlan('required');

    expect(plan.map((step) => step.label)).toEqual([
      'repo biome check',
      'repo biome lint',
      'repo tool contracts',
      'bun asset sources',
      'bun feature projections',
      'bun full demo sync',
      'framework package graph build',
      'module contract tests',
      'testing contract tests',
      'backend tooling tests',
      'backend tooling smoke',
      'frontend tooling tests',
      'testing tooling tests',
      'testing tooling smoke',
      'bun orchestrator required suite',
      'bun package install smoke',
      'portal build',
    ]);
    expect(plan.filter((step) => step.command.includes('build'))).toHaveLength(2);
    expect(plan.find((step) => step.label === 'framework package graph build')?.command).toEqual([
      'bun',
      'run',
      '--filter',
      '@webstir-io/webstir',
      'build',
    ]);
    expect(
      plan
        .filter((step) => step.label.endsWith('tests'))
        .every((step) => step.command.includes('test:built')),
    ).toBe(true);
    expect(plan.some((step) => step.command.includes('test:install:standalone'))).toBe(false);
  });
});
