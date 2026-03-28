import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTempWorkspace,
  parseEvents,
  removeWorkspace,
  runCli,
  writeWorkspaceTest,
} from './support.js';

test('CLI test emits per-runtime and overall summaries for a mixed workspace', async () => {
  const workspaceRoot = await createTempWorkspace('webstir-testing-cli-');

  try {
    await writeWorkspaceTest(workspaceRoot, 'frontend', 'home', { testName: 'frontend passes' });
    await writeWorkspaceTest(workspaceRoot, 'backend', 'api', { testName: 'backend passes' });

    const result = runCli(['test', '--workspace', workspaceRoot], {
      env: {
        WEBSTIR_BACKEND_TESTS: 'skip',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const events = parseEvents(result.stdout);
    const resultEvents = events.filter((event) => event.type === 'result');
    const summaryEvents = events.filter((event) => event.type === 'summary');
    const startEvent = events.find((event) => event.type === 'start');

    assert.ok(startEvent);
    assert.equal(startEvent.manifest.modules.length, 2);
    assert.deepEqual(
      resultEvents.map((event) => [event.runtime, event.result.name]),
      [
        ['backend', 'backend passes'],
        ['frontend', 'frontend passes'],
      ],
    );
    assert.deepEqual(
      summaryEvents.map((event) => [event.runtime, event.summary.passed, event.summary.failed]),
      [
        ['backend', 1, 0],
        ['frontend', 1, 0],
        ['all', 2, 0],
      ],
    );
  } finally {
    await removeWorkspace(workspaceRoot);
  }
});

test('CLI test honors WEBSTIR_TEST_RUNTIME=backend', async () => {
  const workspaceRoot = await createTempWorkspace('webstir-testing-cli-filter-');

  try {
    await writeWorkspaceTest(workspaceRoot, 'frontend', 'home', { testName: 'frontend passes' });
    await writeWorkspaceTest(workspaceRoot, 'backend', 'api', { testName: 'backend passes' });

    const result = runCli(['test', '--workspace', workspaceRoot], {
      env: {
        WEBSTIR_BACKEND_TESTS: 'skip',
        WEBSTIR_TEST_RUNTIME: 'backend',
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const events = parseEvents(result.stdout);
    const startEvent = events.find((event) => event.type === 'start');
    const logEvent = events.find((event) => event.type === 'log');
    const resultEvents = events.filter((event) => event.type === 'result');
    const overallSummary = events.at(-1);

    assert.ok(startEvent);
    assert.equal(startEvent.manifest.modules.length, 1);
    assert.equal(startEvent.manifest.modules[0]?.runtime, 'backend');
    assert.equal(logEvent?.message, "Runtime filter 'backend' matched 1 test (1 skipped).");
    assert.deepEqual(
      resultEvents.map((event) => event.runtime),
      ['backend'],
    );
    assert.equal(overallSummary?.type, 'summary');
    assert.equal(overallSummary?.runtime, 'all');
    assert.equal(overallSummary?.summary.total, 1);
    assert.equal(overallSummary?.summary.failed, 0);
  } finally {
    await removeWorkspace(workspaceRoot);
  }
});
