import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PACKAGED_FEATURES } from '../src/feature-imports.ts';
import { findCopyReferences } from '../src/feature-references.ts';

// Any file that could still load a search copy keeps it: stylesheets with a query on the import,
// scripts in any module format or in a folder that happens to be called build, and HTML naming the
// copy's path. Dependencies and the workspace's own build output do not count.
const referenceCases: Array<{ file: string; text: string; uses: boolean }> = [
  {
    file: 'src/frontend/app/styles/extra.css',
    text: '@import "./features/search.css?v=1";',
    uses: true,
  },
  {
    file: 'src/frontend/pages/build/index.ts',
    text: "import '../../app/scripts/features/search.js';",
    uses: true,
  },
  {
    file: 'tools/check.cts',
    text: "const search = require('../src/frontend/app/scripts/features/search.js');",
    uses: true,
  },
  {
    file: 'src/frontend/app/app.html',
    text: '<link rel="stylesheet" href="/app/styles/features/search.css">',
    uses: true,
  },
  {
    file: 'build/frontend/app/app.js',
    text: "import './scripts/features/search.js';",
    uses: false,
  },
  {
    file: 'packages/site/node_modules/x/index.js',
    text: "import '../../../../src/frontend/app/scripts/features/search.js';",
    uses: false,
  },
  {
    file: 'src/frontend/app/app.ts',
    text: "import '@webstir-io/webstir-frontend/features/search';",
    uses: false,
  },
];

for (const { file, text, uses } of referenceCases) {
  test(`${file} ${uses ? 'keeps' : 'does not keep'} the search copies`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-feature-references-'));
    try {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
      const found = await findCopyReferences(root, PACKAGED_FEATURES.search, new Map());
      expect(found).toEqual(uses ? [file] : []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
