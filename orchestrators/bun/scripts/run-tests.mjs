import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const testsDir = path.join(packageRoot, 'tests');

const browserTestFile = 'tests/progressive-enhancement.browser.integration.test.ts';
const browserTestFiles = [
  browserTestFile,
  'tests/runtime-boundary.integration.test.ts',
  'tests/bun-first-spa.integration.test.ts',
  'tests/ssg-watch.integration.test.ts',
  'tests/full-watch.integration.test.ts',
];

function buildIsolatedTestStep(label, files) {
  return {
    label,
    args: ['test', '--bail=1', '--parallel=2', '--max-concurrency=1', ...files],
  };
}

export function listCoreTestFiles() {
  return readdirSync(testsDir)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => !browserTestFiles.includes(path.posix.join('tests', file)))
    .sort()
    .map((file) => path.posix.join('tests', file));
}

export function listBrowserTestFiles() {
  return [...browserTestFiles];
}

export function buildTestPlan(mode) {
  const coreTests = buildIsolatedTestStep('core orchestrator tests', listCoreTestFiles());
  const browserTests = buildIsolatedTestStep(
    'browser publish and watch proofs',
    listBrowserTestFiles(),
  );
  const requiredPlan = [coreTests, browserTests];

  switch (mode) {
    case 'required':
      return requiredPlan;
    case 'core':
      return [coreTests];
    case 'browser':
      return [browserTests];
    default:
      throw new Error(
        `Unknown orchestrator test mode "${mode}". Expected one of: required, core, browser.`,
      );
  }
}

function runStep(step) {
  const result = spawnSync('bun', step.args, {
    cwd: packageRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function isCliInvocation() {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isCliInvocation()) {
  const mode = process.argv[2] ?? 'required';
  const plan = buildTestPlan(mode);

  for (const step of plan) {
    console.log(`[webstir][tests] ${step.label}`);
    runStep(step);
  }
}
