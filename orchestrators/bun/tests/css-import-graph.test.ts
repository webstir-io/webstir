import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';

import { resolveLocalCssDependencyGraph } from '../src/css-import-graph.ts';

test('resolves recursive local CSS imports without treating external imports as files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-css-graph-'));
  const stylesRoot = path.join(root, 'styles');
  const nestedRoot = path.join(stylesRoot, 'nested');
  const entryPath = path.join(root, 'entry.css');
  const firstPath = path.join(stylesRoot, 'first.css');
  const secondPath = path.join(nestedRoot, 'second.css');

  try {
    await mkdir(nestedRoot, { recursive: true });
    await Promise.all([
      writeFile(
        entryPath,
        [
          '@import url("./styles/first.css?v=1") layer(base);',
          '@import "https://example.com/fonts.css";',
          '@import "@app/app.css";',
          '/* @import "./ignored.css"; */',
        ].join('\n'),
        'utf8',
      ),
      writeFile(firstPath, '@import "./nested/second.css" supports(display: grid);\n', 'utf8'),
      writeFile(secondPath, '@import "../first.css";\n', 'utf8'),
    ]);

    expect([...(await resolveLocalCssDependencyGraph(entryPath))].sort()).toEqual(
      [entryPath, firstPath, secondPath].sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
