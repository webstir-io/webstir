import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { frontendProvider } from '../dist/index.js';

async function workspace({ server = false, enable = {}, appCss = null, appTs = null }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-shell-assets-'));
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'shell-assets', webstir: { enable } }),
  );
  if (server) {
    await fs.mkdir(path.join(root, 'src', 'backend'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'backend', 'index.ts'), 'export {};\n');
  }
  const app = path.join(root, 'src', 'frontend', 'app');
  const home = path.join(root, 'src', 'frontend', 'pages', 'home');
  await fs.mkdir(app, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(
    path.join(app, 'app.html'),
    '<!DOCTYPE html><html><head><title>App</title></head><body><main></main></body></html>',
  );
  if (appCss !== null) await fs.writeFile(path.join(app, 'app.css'), appCss);
  if (appTs !== null) await fs.writeFile(path.join(app, 'app.ts'), appTs);
  await fs.writeFile(
    path.join(home, 'index.html'),
    '<head><link rel="stylesheet" href="index.css"></head><main><p>Home</p></main>',
  );
  await fs.writeFile(path.join(home, 'index.css'), '.home { color: red; }\n');
  return root;
}

async function build(root, mode) {
  await frontendProvider.build({
    workspaceRoot: root,
    env: { WEBSTIR_MODULE_MODE: mode },
    incremental: false,
  });
}

const read = (...parts) => fs.readFile(path.join(...parts), 'utf8');
const exists = (...parts) =>
  fs.access(path.join(...parts)).then(
    () => true,
    () => false,
  );

// The app bundle every page loads: the error reporter for an app with a server unless the flag
// says otherwise, and nothing at all when there is nothing to load.
for (const [name, options, reports] of [
  ['an app with a server', { server: true }, true],
  [
    'an app with a server and clientErrors off',
    { server: true, enable: { clientErrors: false } },
    false,
  ],
  ['an app without a server', {}, false],
  ['an app without a server and clientErrors on', { enable: { clientErrors: true } }, true],
]) {
  test(`${name} ${reports ? 'reports' : 'does not report'} browser errors`, async () => {
    const root = await workspace(options);
    try {
      await build(root, 'build');
      const page = await read(root, 'build', 'frontend', 'pages', 'home', 'index.html');
      assert.equal(/<script\b[^>]*src="\/app\/app\.js"/.test(page), reports, 'app bundle tag');
      const bundle = path.join(root, 'build', 'frontend', 'app', 'app.js');
      assert.equal(await exists(bundle), reports, 'app bundle');
      if (reports) assert.match(await read(bundle), /\/client-errors/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test("an app's own app.ts is bundled after the features it enables", async () => {
  const root = await workspace({
    enable: { clientNav: true },
    appTs: "document.documentElement.dataset.theme = 'own-theme';\n",
  });
  try {
    await build(root, 'build');
    const bundle = await read(root, 'build', 'frontend', 'app', 'app.js');
    const feature = bundle.indexOf('webstir:client-nav');
    const own = bundle.indexOf('own-theme');
    assert.ok(feature !== -1 && own > feature, 'client-nav, then the app entry');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

const stylesheets = (html) =>
  [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((match) => match[1]);

// Every page links the app's styles ahead of its own, whether they come from app.css or only
// from an enabled feature's stylesheet.
for (const [name, options, expected] of [
  ['app.css', { appCss: '.app { color: blue; }\n' }, /\.app\s*\{/],
  ['a feature flag alone', { enable: { search: true } }, /#webstir-search/],
]) {
  test(`${name}: every page links the app's styles before its own, in build and publish`, async () => {
    const root = await workspace({ server: true, ...options });
    try {
      await build(root, 'build');
      const built = stylesheets(
        await read(root, 'build', 'frontend', 'pages', 'home', 'index.html'),
      );
      assert.equal(built[0], '/app/app.css');
      assert.ok(built.length > 1, 'the page keeps its own stylesheet');

      await build(root, 'publish');
      const html = await read(root, 'dist', 'frontend', 'pages', 'home', 'index.html');
      const [appHref] = stylesheets(html);
      assert.match(appHref, /^\/app\/app-[^/]+\.css$/);
      // Publish inlines a small page stylesheet, so the page's own rules follow as a style block.
      const pageStyles = Math.max(html.indexOf('.home{'), html.indexOf('/pages/home/index-'));
      assert.ok(html.indexOf(appHref) < pageStyles, "the app's styles come before the page's");
      assert.match(await read(root, 'dist', 'frontend', appHref), expected);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test('an app with no styles of its own links none', async () => {
  const root = await workspace({ server: true });
  try {
    await build(root, 'build');
    const built = stylesheets(await read(root, 'build', 'frontend', 'pages', 'home', 'index.html'));
    assert.ok(!built.includes('/app/app.css'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
