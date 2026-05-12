import { expect, test } from 'bun:test';

import { buildTestPlan, listCoreTestFiles } from '../scripts/run-tests.mjs';

test('required orchestrator plan includes watch browser proofs in the default gate', () => {
  const plan = buildTestPlan('required');
  const coreFiles = listCoreTestFiles();

  expect(plan).toHaveLength(coreFiles.length + 6);
  expect(plan[0]?.args).toContain('tests/add.integration.test.ts');
  expect(plan[0]?.args).not.toContain('tests/progressive-enhancement.browser.integration.test.ts');
  expect(plan.slice(0, coreFiles.length).map((step) => step.args.at(-1))).toEqual(coreFiles);
  expect(plan[coreFiles.length]?.args).toEqual([
    'test',
    '--bail=1',
    'tests/progressive-enhancement.browser.integration.test.ts',
    '-t',
    'publish mode',
  ]);
  expect(plan.slice(coreFiles.length + 1, coreFiles.length + 5).map((step) => step.args)).toEqual([
    ['test', '--bail=1', 'tests/runtime-boundary.integration.test.ts'],
    ['test', '--bail=1', 'tests/bun-first-spa.integration.test.ts'],
    ['test', '--bail=1', 'tests/ssg-watch.integration.test.ts'],
    ['test', '--bail=1', 'tests/full-watch.integration.test.ts'],
  ]);
  expect(plan[coreFiles.length + 5]?.args).toEqual([
    'test',
    '--bail=1',
    'tests/progressive-enhancement.browser.integration.test.ts',
    '-t',
    'watch mode',
  ]);
});

test('with-watch-browser orchestrator plan remains an alias for the default required plan', () => {
  expect(buildTestPlan('with-watch-browser')).toEqual(buildTestPlan('required'));
});

test('core orchestrator file list remains sorted for deterministic runs', () => {
  const files = listCoreTestFiles();
  const sorted = [...files].sort();

  expect(files).toEqual(sorted);
});
