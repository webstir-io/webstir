import { expect, test } from 'bun:test';
import path from 'node:path';

import { formatWorkspaceWatchEvent, mergeWorkspaceWatchEvents } from '../src/bun-ssg-watch.ts';
import type { WorkspaceWatchEvent } from '../src/workspace-watcher.ts';

const workspaceRoot = path.resolve('/workspace');
const homeCss = path.join(workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.css');
const servicesCss = path.join(workspaceRoot, 'src', 'frontend', 'pages', 'services', 'index.css');

test('mergeWorkspaceWatchEvents preserves a repeated single-file change', () => {
  const change = { type: 'change', path: homeCss } satisfies WorkspaceWatchEvent;

  expect(mergeWorkspaceWatchEvents(undefined, change)).toEqual(change);
  expect(mergeWorkspaceWatchEvents(change, change)).toEqual(change);
});

test('mergeWorkspaceWatchEvents collapses multi-file changes into one reload', () => {
  const merged = mergeWorkspaceWatchEvents(
    { type: 'change', path: homeCss },
    { type: 'change', path: servicesCss },
  );

  expect(merged).toEqual({
    type: 'reload',
    paths: [homeCss, servicesCss],
  });
});

test('formatWorkspaceWatchEvent reports workspace-relative verbose trigger paths', () => {
  expect(formatWorkspaceWatchEvent({ type: 'change', path: homeCss }, workspaceRoot)).toBe(
    'changed src/frontend/pages/home/index.css',
  );
  expect(
    formatWorkspaceWatchEvent(
      {
        type: 'reload',
        paths: [homeCss, servicesCss],
      },
      workspaceRoot,
    ),
  ).toBe(
    'reload 2 changes: src/frontend/pages/home/index.css, src/frontend/pages/services/index.css',
  );
});
