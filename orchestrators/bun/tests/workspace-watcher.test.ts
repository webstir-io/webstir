import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
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
  handleRename(root: string, absolutePath: string | undefined): Promise<void>;
  syncTree(root: string): Promise<void>;
  readonly treeWatchers: Map<string, { close(): void }>;
  readonly rootWatcher?: { close(): void };
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

const resyncCases: ReadonlyArray<{
  readonly title: string;
  readonly edit: (filePath: string) => Promise<void>;
  readonly notify: (
    internals: WorkspaceWatcherInternals,
    root: string,
    filePath: string,
  ) => Promise<void>;
  readonly expected: (filePath: string) => WorkspaceWatchEvent;
}> = [
  {
    title: 'a write',
    edit: (filePath) => writeFile(filePath, 'page-v2', 'utf8'),
    notify: (internals, root, filePath) => internals.handleFileChange(root, filePath),
    expected: (filePath) => ({ type: 'change', path: filePath }),
  },
  {
    title: 'a new file',
    edit: (filePath) => writeFile(`${filePath}.added`, 'added', 'utf8'),
    notify: (internals, root, filePath) => internals.handleRename(root, `${filePath}.added`),
    expected: (filePath) => ({
      type: 'reload',
      path: `${filePath}.added`,
      paths: [`${filePath}.added`],
    }),
  },
  {
    title: 'a removed file',
    edit: (filePath) => unlink(filePath),
    notify: (internals, root, filePath) => internals.handleRename(root, filePath),
    expected: (filePath) => ({ type: 'reload', path: filePath, paths: [filePath] }),
  },
];

for (const scenario of resyncCases) {
  test(`WorkspaceWatcher reports ${scenario.title} that a resync sees before its notification`, async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'webstir-workspace-watcher-resync-'));
    cleanupRoots.push(workspaceRoot);
    const sourceRoot = path.join(workspaceRoot, 'src');
    const pageDir = path.join(sourceRoot, 'frontend', 'pages', 'home');
    await mkdir(pageDir, { recursive: true });
    const pagePath = path.join(pageDir, 'index.html');
    await writeFile(pagePath, 'page-v1', 'utf8');

    const events: WorkspaceWatchEvent[] = [];
    const watcher = new WorkspaceWatcher({
      workspaceRoot,
      debounceMs: 25,
      onEvent(event) {
        events.push(event);
      },
    });
    await watcher.start();
    const internals = watcher as unknown as WorkspaceWatcherInternals;
    // Only the calls below deliver notifications, in the order a slow watcher would.
    internals.rootWatcher?.close();
    for (const directoryWatcher of internals.treeWatchers.values()) {
      directoryWatcher.close();
    }

    try {
      await scenario.edit(pagePath);
      await internals.syncTree(sourceRoot);
      await scenario.notify(internals, sourceRoot, pagePath);
      await waitFor(async () => {
        expect(events).toEqual([scenario.expected(pagePath)]);
      }, 2_000);
    } finally {
      await watcher.stop();
    }
  });
}
