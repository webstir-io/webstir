import { expect, test } from 'bun:test';

import { buildAgentTaskBenchmarkPlan } from '../run-agent-task-benchmarks.mjs';

test('agent task benchmark plan stays pinned to the recipe apps', () => {
  const plan = buildAgentTaskBenchmarkPlan();

  expect(plan.map((step) => step.label)).toEqual([
    'full recipe: doctor',
    'full recipe: backend-inspect',
    'full recipe: test',
    'full recipe: publish',
    'auth-crud recipe: backend-inspect',
    'auth-crud recipe: test',
    'dashboard recipe: backend-inspect',
    'dashboard recipe: test',
  ]);

  expect(plan.every((step) => step.command[0] === 'bun')).toBe(true);
  expect(plan.every((step) => step.command.includes('--workspace'))).toBe(true);
  expect(plan.some((step) => step.command.includes('publish'))).toBe(true);
});
