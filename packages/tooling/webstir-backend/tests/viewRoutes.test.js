import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createRenderedViewMatcher } from '../dist/runtime/view-routes.js';

test('every view that names a page routes to the backend, and assets never do', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-view-routes-'));
  try {
    await fs.mkdir(path.join(workspace, 'build', 'backend'), { recursive: true });
    await fs.writeFile(
      path.join(workspace, 'build', 'backend', 'views.json'),
      JSON.stringify([
        { name: 'secret', path: '/secret', page: 'secret' },
        { name: 'client', path: '/clients/:slug', page: 'client' },
        { name: 'legacy', path: '/legacy' },
      ]),
    );
    const matches = createRenderedViewMatcher({ workspaceRoot: workspace });

    // A page with no bindings compiles to no program, but its loader still has to run.
    assert.equal(await matches('/secret'), true);
    assert.equal(await matches('/clients/acme'), true);
    assert.equal(await matches('/clients/acme.inc/'), true, 'a dotted parameter is not an asset');
    assert.equal(await matches('/clients/index.css'), false, "a page's stylesheet is an asset");
    assert.equal(await matches('/clients/logo.png'), false);
    assert.equal(await matches('/legacy'), false, 'a view without a page is not rendered here');
    assert.equal(await matches('/elsewhere'), false);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
