import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { frontendProvider } from '../dist/index.js';

// A standalone build of an app with no server checks bindings itself unless the app has view
// loaders, whose views only exist once the backend builds them.
test('a standalone build checks bindings only when nothing else could render the page', async () => {
  for (const { loaders, fails } of [
    { loaders: null, fails: true },
    { loaders: 'module.ts', fails: false },
    { loaders: 'module/index.ts', fails: false },
  ]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-unrendered-bindings-'));
    try {
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'site' }));
      const app = path.join(root, 'src', 'frontend', 'app');
      const page = path.join(root, 'src', 'frontend', 'pages', 'post');
      await fs.mkdir(app, { recursive: true });
      await fs.mkdir(page, { recursive: true });
      await fs.writeFile(
        path.join(app, 'app.html'),
        '<!DOCTYPE html><html><head><title>Site</title></head><body><main></main></body></html>',
      );
      await fs.writeFile(
        path.join(page, 'index.html'),
        '<main><h1 data-text="title">Post</h1></main>',
      );
      if (loaders) {
        const file = path.join(root, 'src', 'backend', loaders);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'export const module = { views: [] };\n');
      }

      const run = frontendProvider.build({
        workspaceRoot: root,
        env: { WEBSTIR_MODULE_MODE: 'build' },
        incremental: false,
      });
      if (fails) {
        await assert.rejects(
          run,
          /page 'post' has bindings, but nothing renders it/,
          String(loaders),
        );
      } else {
        await run;
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});
