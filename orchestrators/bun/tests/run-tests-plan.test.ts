import { expect, test } from 'bun:test';

import { buildTestPlan, listCoreTestFiles } from '../scripts/run-tests.mjs';

test('required orchestrator plan excludes watch browser proofs from the default gate', () => {
  const plan = buildTestPlan('required');

  expect(plan).toHaveLength(2);
  expect(plan[0]?.args).toContain('tests/add.integration.test.ts');
  expect(plan[0]?.args).not.toContain('tests/runtime-boundary.integration.test.ts');
  expect(plan[0]?.args).not.toContain('tests/bun-first-spa.integration.test.ts');
  expect(plan[0]?.args).not.toContain('tests/ssg-watch.integration.test.ts');
  expect(plan[0]?.args).not.toContain('tests/full-watch.integration.test.ts');
  expect(plan[0]?.args).not.toContain('tests/progressive-enhancement.browser.integration.test.ts');
  expect(plan[1]?.args).toEqual([
    'test',
    '--bail=1',
    'tests/progressive-enhancement.browser.integration.test.ts',
    '-t',
    'publish mode',
  ]);
});

test('with-watch-browser orchestrator plan adds watch browser tests to the required plan', () => {
  const plan = buildTestPlan('with-watch-browser');

  expect(plan).toHaveLength(4);
  expect(plan[2]?.args).toEqual([
    'test',
    '--bail=1',
    'tests/runtime-boundary.integration.test.ts',
    'tests/bun-first-spa.integration.test.ts',
    'tests/ssg-watch.integration.test.ts',
    'tests/full-watch.integration.test.ts',
  ]);
  expect(plan[3]?.args).toEqual([
    'test',
    '--bail=1',
    'tests/progressive-enhancement.browser.integration.test.ts',
    '-t',
    'watch mode',
  ]);
});

test('core orchestrator file list remains sorted for deterministic runs', () => {
  const files = listCoreTestFiles();
  const sorted = [...files].sort();

  expect(files).toEqual(sorted);
});
