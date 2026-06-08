import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { WorkspaceWatcher, type WorkspaceWatchEvent } from '../src/workspace-watcher.ts';
import { waitFor } from '../test-support/watch.ts';

const cleanupRoots: string[] = [];

afterEach(async () => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

interface WorkspaceWatcherInternals {
  handleFileChange(root: string, absolutePath: string): Promise<void>;
}

test('WorkspaceWatcher ignores unchanged file notifications and reports real writes', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'webstir-workspace-watcher-'));
  cleanupRoots.push(workspaceRoot);

  const fontDir = path.join(workspaceRoot, 'src', 'frontend', 'fonts');
  await mkdir(fontDir, { recursive: true });
  const sourceFont = path.join(fontDir, 'font.woff2');
  await writeFile(sourceFont, 'font-v1', 'utf8');

  const events: WorkspaceWatchEvent[] = [];
  const watcher = new WorkspaceWatcher({
    workspaceRoot,
    debounceMs: 25,
    onEvent(event) {
      events.push(event);
    },
  });

  await watcher.start();

  try {
    const internals = watcher as unknown as WorkspaceWatcherInternals;
    await internals.handleFileChange(path.join(workspaceRoot, 'src'), sourceFont);
    await Bun.sleep(150);
    expect(events).toEqual([]);

    await writeFile(sourceFont, 'font-v2-longer', 'utf8');
    await internals.handleFileChange(path.join(workspaceRoot, 'src'), sourceFont);
    await waitFor(async () => {
      expect(events).toEqual([{ type: 'change', path: sourceFont }]);
    }, 2_000);
  } finally {
    await watcher.stop();
  }
});
