import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  collectCliEvents,
  createTempWorkspace,
  removeWorkspace,
  startCli,
  stopChild,
  writeWorkspaceTest,
} from './support.js';

test('CLI watch reruns after a source change', async () => {
  const workspaceRoot = await createTempWorkspace('webstir-testing-watch-');
  const fixture = await writeWorkspaceTest(workspaceRoot, 'frontend', 'watch', {
    testName: 'watch passes',
  });
  const child = startCli(['watch', '--workspace', workspaceRoot, '--debounce', '50']);
  const collector = collectCliEvents(child);

  try {
    const firstComplete = await collector.waitForEvent(
      (event) =>
        event.type === 'watch-iteration' &&
        event.phase === 'complete' &&
        event.iteration === 1 &&
        event.summary?.passed === 1,
    );

    assert.deepEqual(firstComplete.changedFiles, []);

    await fs.writeFile(
      fixture.buildPath,
      `const { test, assert } = require('@webstir-io/webstir-testing');

test('watch rerun fails', () => {
  assert.equal(1, 2);
});
`,
      'utf8',
    );
    await fs.writeFile(fixture.sourcePath, '// trigger rerun\n', 'utf8');

    const secondComplete = await collector.waitForEvent(
      (event) =>
        event.type === 'watch-iteration' &&
        event.phase === 'complete' &&
        event.iteration === 2 &&
        event.summary?.failed === 1,
    );

    assert.deepEqual(secondComplete.changedFiles, ['src/frontend/tests/watch.test.ts']);
  } finally {
    await stopChild(child);
    await removeWorkspace(workspaceRoot);
  }
});
