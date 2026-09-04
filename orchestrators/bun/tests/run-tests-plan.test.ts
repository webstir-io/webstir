import { expect, test } from 'bun:test';

import { buildTestPlan, listBrowserTestFiles, listCoreTestFiles } from '../scripts/run-tests.mjs';

test('required orchestrator plan runs the complete inventory in two isolated worker pools', () => {
  const plan = buildTestPlan('required');
  const coreFiles = listCoreTestFiles();
  const browserFiles = listBrowserTestFiles();

  expect(plan).toHaveLength(2);
  expect(plan[0]?.label).toBe('core orchestrator tests');
  expect(plan[0]?.args.slice(0, 4)).toEqual([
    'test',
    '--bail=1',
    '--parallel=2',
    '--max-concurrency=1',
  ]);
  expect(plan[0]?.args.slice(4)).toEqual(coreFiles);
  expect(plan[1]?.label).toBe('browser publish and watch proofs');
  expect(plan[1]?.args.slice(4)).toEqual(browserFiles);
  expect(buildTestPlan('core')).toEqual([plan[0]]);
  expect(buildTestPlan('browser')).toEqual([plan[1]]);
});

test('core and browser test inventories are complete and non-overlapping', () => {
  const files = listCoreTestFiles();
  const browserFiles = listBrowserTestFiles();
  const sorted = [...files].sort();

  expect(files).toEqual(sorted);
  expect(browserFiles).toHaveLength(5);
  expect(browserFiles).toContain('tests/progressive-enhancement.browser.integration.test.ts');
  expect(browserFiles).toContain('tests/full-watch.integration.test.ts');
  expect(new Set([...files, ...browserFiles]).size).toBe(38);
});
