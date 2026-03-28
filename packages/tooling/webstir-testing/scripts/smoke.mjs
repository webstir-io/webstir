import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createTempWorkspace,
  parseEvents,
  runEntrypoint,
  writeWorkspaceTest,
} from '../tests/support.js';

async function main() {
  const workspaceRoot = await createTempWorkspace('webstir-testing-smoke-');

  try {
    await seedWorkspace(workspaceRoot);
    await runSmokeStep('runner', ['test', '--workspace', workspaceRoot], (result) => {
      const summary = parseEvents(result.stdout).at(-1);
      assert.equal(summary?.type, 'summary');
      assert.equal(summary?.summary.passed, 2);
      assert.equal(summary?.summary.failed, 0);
    });
    await runSmokeStep(
      'backend-filter',
      ['test', '--workspace', workspaceRoot],
      (result) => {
        const events = parseEvents(result.stdout);
        const logEvent = events.find((event) => event.type === 'log');
        const summary = events.at(-1);

        assert.equal(logEvent?.message, "Runtime filter 'backend' matched 1 test (1 skipped).");
        assert.equal(summary?.type, 'summary');
        assert.equal(summary?.summary.total, 1);
        assert.equal(summary?.summary.failed, 0);
      },
      {
        WEBSTIR_BACKEND_TESTS: 'skip',
        WEBSTIR_TEST_RUNTIME: 'backend',
      },
    );
    await runSmokeStep(
      'add-cli',
      ['generated-smoke', '--workspace', workspaceRoot],
      async () => {
        const generated = path.join(workspaceRoot, 'src', 'tests', 'generated-smoke.test.ts');
        const source = await fs.readFile(generated, 'utf8');
        assert.match(source, /sample passes/);
      },
      {},
      'dist/add-cli.js',
    );
    console.log('[smoke] webstir-testing CLI smoke passed');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function seedWorkspace(workspaceRoot) {
  await writeWorkspaceTest(workspaceRoot, 'frontend', 'smoke', { testName: 'smoke runner passes' });
  await writeWorkspaceTest(workspaceRoot, 'backend', 'smoke', { testName: 'backend smoke passes' });
}

async function runSmokeStep(label, args, validate, env = {}, entrypoint = 'dist/cli.js') {
  const result = runEntrypoint(entrypoint, args, {
    env: {
      WEBSTIR_BACKEND_TESTS: 'skip',
      ...env,
    },
  });

  assert.equal(result.status, 0, `[smoke:${label}] ${result.stderr}`);
  await validate(result);
}

void main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
