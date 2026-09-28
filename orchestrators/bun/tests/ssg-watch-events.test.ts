import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  createHotUpdatePayload,
  formatWorkspaceWatchEvent,
  mergeWorkspaceWatchEvents,
} from '../src/document-watch.ts';
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

test('createHotUpdatePayload sends each rebuilt file the way the browser should take it', () => {
  const frontend = path.join(workspaceRoot, 'src', 'frontend');
  const cases = [
    { file: 'app/app.css', ssg: false, expected: 'css:app/app.css' },
    { file: 'pages/home/index.css', ssg: false, expected: 'css:pages/home/index.css' },
    { file: 'pages/home/index.ts', ssg: false, expected: 'refresh' },
    { file: 'pages/home/helpers.tsx', ssg: true, expected: 'refresh' },
    { file: 'pages/guides/intro/index.ts', ssg: false, expected: 'refresh' },
    { file: 'pages/docs/index.ts', ssg: false, expected: 'refresh' },
    { file: 'pages/docs/index.ts', ssg: true, expected: 'module:pages/docs/index.js' },
    { file: 'content/_sidebar.json', ssg: true, expected: 'module:pages/docs/index.js' },
    { file: 'content/_sidebar.json', ssg: false, expected: 'reload' },
    { file: 'pages/home/index.html', ssg: false, expected: 'reload' },
    { file: 'app/app.ts', ssg: false, expected: 'reload' },
    { file: 'app/app.html', ssg: true, expected: 'reload' },
  ];

  for (const { file, ssg, expected } of cases) {
    const payload = createHotUpdatePayload({
      workspaceRoot,
      frontendSourceRoot: frontend,
      buildRoot: path.join(workspaceRoot, 'build', 'frontend'),
      changedFile: path.join(frontend, file),
      docsModuleSwap: ssg,
    });
    const kind = !payload
      ? 'reload'
      : payload.pageRefresh
        ? 'refresh'
        : payload.styles[0]
          ? `css:${payload.styles[0].relativePath}`
          : `module:${payload.modules[0]?.relativePath}`;
    expect(`${file} (ssg: ${ssg}) -> ${kind}`).toBe(`${file} (ssg: ${ssg}) -> ${expected}`);
    if (payload?.pageRefresh) expect(payload.requiresReload).toBe(true);
  }
});
