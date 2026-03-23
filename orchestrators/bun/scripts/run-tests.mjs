import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const testsDir = path.join(packageRoot, 'tests');

const browserTestFile = 'tests/progressive-enhancement.browser.integration.test.ts';
const watchBrowserTestFiles = [
  'tests/runtime-boundary.integration.test.ts',
  'tests/bun-first-spa.integration.test.ts',
  'tests/ssg-watch.integration.test.ts',
  'tests/full-watch.integration.test.ts',
];
const publishModeFilter = 'publish mode';
const watchModeFilter = 'watch mode';

export function listCoreTestFiles() {
  return readdirSync(testsDir)
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => file !== path.basename(browserTestFile))
    .filter((file) => !watchBrowserTestFiles.includes(path.posix.join('tests', file)))
    .sort()
    .map((file) => path.posix.join('tests', file));
}

export function buildTestPlan(mode) {
  const coreTests = {
    label: 'core orchestrator tests',
    args: ['test', '--bail=1', ...listCoreTestFiles()],
  };
  const publishBrowserTests = {
    label: 'browser publish proofs',
    args: ['test', '--bail=1', browserTestFile, '-t', publishModeFilter],
  };
  const integrationWatchBrowserTests = {
    label: 'browser watch integration proofs',
    args: ['test', '--bail=1', ...watchBrowserTestFiles],
  };
  const watchBrowserTests = {
    label: 'browser watch proofs',
    args: ['test', '--bail=1', browserTestFile, '-t', watchModeFilter],
  };

  switch (mode) {
    case 'required':
      return [coreTests, publishBrowserTests];
    case 'publish-browser':
      return [publishBrowserTests];
    case 'watch-browser':
      return [integrationWatchBrowserTests, watchBrowserTests];
    case 'all':
    case 'with-watch-browser':
      return [coreTests, publishBrowserTests, integrationWatchBrowserTests, watchBrowserTests];
    default:
      throw new Error(
        `Unknown orchestrator test mode "${mode}". Expected one of: required, publish-browser, watch-browser, with-watch-browser.`,
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
