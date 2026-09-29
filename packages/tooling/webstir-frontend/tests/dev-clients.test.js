import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { frontendProvider } from '../dist/index.js';

const packagedClients = fileURLToPath(new URL('../src/dev-clients/', import.meta.url));
const TAGS = {
  hmr: /<script\b[^>]*src="\/hmr\.js"/g,
  refresh: /<script\b[^>]*src="\/refresh\.js"/g,
};

async function workspace(shellBody) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-dev-clients-'));
  // A server app, so its pages publish where this reads them.
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'dev-clients', webstir: {} }),
  );
  await fs.mkdir(path.join(root, 'src', 'backend'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'backend', 'index.ts'), 'export {};\n');
  await fs.mkdir(path.join(root, 'src', 'frontend', 'app'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'frontend', 'pages', 'home'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'src', 'frontend', 'app', 'app.html'),
    `<!DOCTYPE html><html><head><title>App</title></head><body><main></main>${shellBody}</body></html>`,
  );
  await fs.writeFile(
    path.join(root, 'src', 'frontend', 'pages', 'home', 'index.html'),
    '<head></head><main><p>Home</p></main>',
  );
  return root;
}

const count = (html, pattern) => (html.match(pattern) ?? []).length;

// A shell that names neither client, as a new app's does, and one that names both, as older apps' do.
for (const [name, shellBody] of [
  ['a shell without the dev clients', ''],
  [
    'a shell that still names them',
    '<script type="module" src="/hmr.js"></script><script src="/refresh.js" async></script>',
  ],
]) {
  test(`${name}: development pages load Webstir's clients once each, and publish drops them`, async () => {
    const root = await workspace(shellBody);
    try {
      await frontendProvider.build({
        workspaceRoot: root,
        env: { WEBSTIR_MODULE_MODE: 'build' },
        incremental: false,
      });
      const built = await fs.readFile(
        path.join(root, 'build', 'frontend', 'pages', 'home', 'index.html'),
        'utf8',
      );
      assert.deepEqual([count(built, TAGS.hmr), count(built, TAGS.refresh)], [1, 1]);
      for (const client of ['hmr.js', 'refresh.js']) {
        assert.equal(
          await fs.readFile(path.join(root, 'build', 'frontend', client), 'utf8'),
          await fs.readFile(path.join(packagedClients, client), 'utf8'),
          client,
        );
      }

      await frontendProvider.build({
        workspaceRoot: root,
        env: { WEBSTIR_MODULE_MODE: 'publish' },
        incremental: false,
      });
      const published = await fs.readFile(
        path.join(root, 'dist', 'frontend', 'pages', 'home', 'index.html'),
        'utf8',
      );
      assert.deepEqual([count(published, TAGS.hmr), count(published, TAGS.refresh)], [0, 0]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test("an app's own copy of a client is not what the page loads", async () => {
  const root = await workspace('');
  try {
    await fs.writeFile(
      path.join(root, 'src', 'frontend', 'app', 'hmr.js'),
      'console.log("old copy");\n',
    );
    await frontendProvider.build({
      workspaceRoot: root,
      env: { WEBSTIR_MODULE_MODE: 'build' },
      incremental: false,
    });
    assert.equal(
      await fs.readFile(path.join(root, 'build', 'frontend', 'hmr.js'), 'utf8'),
      await fs.readFile(path.join(packagedClients, 'hmr.js'), 'utf8'),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// A tag inside an HTML comment loads nothing, so the build still adds its own.
import { withAppBundle, withAppStyles, withDevClients } from '../dist/html/shellAssets.js';

for (const [name, add, commented, expected] of [
  [
    'dev clients',
    withDevClients,
    '<!-- <script type="module" src="/hmr.js"></script> -->',
    /<script type="module" src="\/hmr\.js"><\/script>\n/,
  ],
  [
    'app bundle',
    (html) => withAppBundle(html, true),
    '<!-- <script src="/app/app.js"></script> -->',
    /<script type="module" src="\/app\/app\.js"><\/script>/,
  ],
  [
    'app styles',
    (html) => withAppStyles(html, true),
    '<!-- <link href="/app/app.css"> -->',
    /<link rel="stylesheet" href="\/app\/app\.css">/,
  ],
]) {
  test(`a commented-out ${name} tag doesn't stand in for the real one`, () => {
    const html = `<html><head>${commented}</head><body><main></main></body></html>`;
    assert.match(add(html), expected);
  });
}
