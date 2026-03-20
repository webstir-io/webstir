import { expect, test } from 'bun:test';

import { collectWatchActions, parseStructuredDiagnosticLine } from '../src/watch-events.ts';

test('collectWatchActions turns pipeline success with hot update into HMR + success', () => {
  const payload = parseStructuredDiagnosticLine(
    'WEBSTIR_DIAGNOSTIC ' +
      JSON.stringify({
        type: 'diagnostic',
        code: 'frontend.watch.pipeline.success',
        kind: 'watch-daemon',
        stage: 'pipeline',
        severity: 'info',
        message: 'Frontend rebuild pipeline completed.',
        data: {
          hotUpdate: {
            requiresReload: false,
            changedFile: 'src/frontend/pages/home/index.ts',
            target: {
              kind: 'boundary',
              id: 'home',
            },
            modules: [
              {
                type: 'js',
                path: '/tmp/build/frontend/pages/home/index.js',
                relativePath: 'pages/home/index.js',
                url: '/pages/home/index.js',
              },
            ],
            styles: [],
          },
        },
      })
  );

  expect(payload).not.toBeNull();
  expect(collectWatchActions(payload!)).toEqual([
    {
      type: 'hmr',
      payload: {
        requiresReload: false,
        changedFile: 'src/frontend/pages/home/index.ts',
        modules: [
          {
            type: 'js',
            path: '/tmp/build/frontend/pages/home/index.js',
            relativePath: 'pages/home/index.js',
            url: '/pages/home/index.js',
          },
        ],
        styles: [],
        target: {
          kind: 'boundary',
          id: 'home',
        },
        fallbackReasons: undefined,
        stats: undefined,
      },
    },
    {
      type: 'status',
      status: 'success',
    },
  ]);
});

test('collectWatchActions requests a full reload when the hot update requires it', () => {
  const payload = parseStructuredDiagnosticLine(
    'WEBSTIR_DIAGNOSTIC ' +
      JSON.stringify({
        type: 'diagnostic',
        code: 'frontend.watch.pipeline.success',
        kind: 'watch-daemon',
        stage: 'pipeline',
        severity: 'info',
        message: 'Frontend rebuild pipeline completed.',
        data: {
          hotUpdate: {
            requiresReload: true,
            changedFile: 'src/frontend/app/router.ts',
            modules: [],
            styles: [],
            fallbackReasons: ['builder.static-assets.reload'],
          },
        },
      })
  );

  expect(payload).not.toBeNull();
  expect(collectWatchActions(payload!)).toEqual([
    {
      type: 'status',
      status: 'hmr-fallback',
    },
    {
      type: 'reload',
    },
  ]);
});
