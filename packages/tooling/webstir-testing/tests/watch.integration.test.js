import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  collectCliEvents,
  createTempWorkspace,
  removeWorkspace,
  startCli,
  stopChild,
  writeWorkspaceTest,
} from './support.js';

test('CLI watch reruns after a source change', { timeout: 15_000 }, async () => {
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

test('CLI watch ignores generated paths and tracks source file lifecycle', {
  timeout: 15_000,
}, async () => {
  const workspaceRoot = await createTempWorkspace('webstir-testing-watch-paths-');
  await writeWorkspaceTest(workspaceRoot, 'frontend', 'watch');
  const ignoredPaths = [
    'src/frontend/node_modules/dependency/index.js',
    'src/frontend/build/generated.js',
    'src/frontend/dist/bundle.js',
    'src/frontend/.cache/state.json',
    'src/frontend/.hidden.ts',
  ];
  for (const relative of ignoredPaths) {
    const filePath = path.join(workspaceRoot, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'initial');
  }
  const child = startCli(['watch', '--workspace', workspaceRoot, '--debounce', '50']);
  const collector = collectCliEvents(child);
  const waitForIteration = (iteration) =>
    collector.waitForEvent(
      (event) =>
        event.type === 'watch-iteration' &&
        event.phase === 'complete' &&
        event.iteration === iteration,
    );

  try {
    await waitForIteration(1);
    for (const relative of ignoredPaths) {
      await fs.writeFile(path.join(workspaceRoot, relative), 'changed');
    }
    await delay(350);
    assert.equal(collector.events.filter((event) => event.type === 'watch-iteration').length, 2);

    const relative = 'src/frontend/build-tools/source.ts';
    const sourcePath = path.join(workspaceRoot, relative);
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, 'export const value = 1;');
    assert.deepEqual((await waitForIteration(2)).changedFiles, [relative]);
    await fs.writeFile(sourcePath, 'export const value = 2;');
    assert.deepEqual((await waitForIteration(3)).changedFiles, [relative]);
    const temporaryPath = path.join(path.dirname(sourcePath), '.source.tmp');
    await fs.writeFile(temporaryPath, 'export const value = 3;');
    await fs.rename(temporaryPath, sourcePath);
    assert.deepEqual((await waitForIteration(4)).changedFiles, [relative]);
    await fs.unlink(sourcePath);
    assert.deepEqual((await waitForIteration(5)).changedFiles, [relative]);
    assert.equal(collector.events.filter((event) => event.type === 'error').length, 0);
  } finally {
    await stopChild(child);
    await removeWorkspace(workspaceRoot);
  }
});
