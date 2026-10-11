import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { load } from 'cheerio';
import { frontendProvider } from '../dist/index.js';

for (const server of [true, false]) {
  test(`publish emits usable prefetch targets for ${server ? 'server' : 'static'} pages`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-prefetch-'));
    try {
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'prefetch-test' }),
      );
      if (server) {
        await fs.mkdir(path.join(root, 'src/backend'), { recursive: true });
        await fs.writeFile(path.join(root, 'src/backend/index.ts'), 'export {};');
      }
      const frontend = path.join(root, 'src/frontend');
      await fs.mkdir(path.join(frontend, 'app'), { recursive: true });
      await fs.writeFile(
        path.join(frontend, 'app/app.html'),
        '<!doctype html><html><head><title>Prefetch</title></head><body><main></main></body></html>',
      );
      for (const page of ['home', 'clients']) {
        await fs.mkdir(path.join(frontend, 'pages', page), { recursive: true });
        await fs.writeFile(
          path.join(frontend, 'pages', page, 'index.html'),
          page === 'home'
            ? `<head></head><main><a href="/clients?view=active#list">Clients</a>${server ? '<a href="/api/account">Account</a>' : ''}</main>`
            : '<head></head><main id="list">Clients</main>',
        );
      }
      for (const mode of ['build', 'publish']) {
        await frontendProvider.build({
          workspaceRoot: root,
          env: { WEBSTIR_MODULE_MODE: mode },
          incremental: false,
        });
      }
      const htmlPath = server ? 'pages/home/index.html' : 'index.html';
      const document = load(await fs.readFile(path.join(root, 'dist/frontend', htmlPath), 'utf8'));
      const hints = document('link[rel="prefetch"]')
        .map((_, el) => document(el).attr('href'))
        .get();
      assert.deepEqual(hints, [server ? '/clients?view=active' : '/clients/index.html']);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}
