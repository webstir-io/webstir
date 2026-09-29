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

// An app from before the build added features still imports client-nav from its own install,
// a different copy than the CLI's; the bundle takes the app's, so client-nav is in it once.
test('an app that still imports a feature gets the same copy the flag adds', async () => {
  const packageRoot = path.resolve(import.meta.dirname, '..');
  const copies = [];
  for (const appTs of [null, "import '@webstir-io/webstir-frontend/features/client-nav';\n"]) {
    const root = await workspace({ enable: { clientNav: true }, appTs });
    try {
      const installed = path.join(root, 'node_modules', '@webstir-io', 'webstir-frontend');
      await fs.mkdir(installed, { recursive: true });
      for (const entry of ['package.json', 'dist', 'src', 'config']) {
        await fs.cp(path.join(packageRoot, entry), path.join(installed, entry), {
          recursive: true,
        });
      }
      await fs.symlink(
        path.join(packageRoot, 'node_modules'),
        path.join(installed, 'node_modules'),
        'dir',
      );
      await build(root, 'build');
      const bundle = await read(root, 'build', 'frontend', 'app', 'app.js');
      copies.push(bundle.split('webstir:client-nav').length - 1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
  assert.ok(copies[0] > 0, 'client-nav is in the bundle');
  assert.equal(copies[1], copies[0], "the app's own import adds no second copy");
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

// The behaviors come with the bundle only when a page, the shell or a partial marks a control.
for (const [name, markup, bundled] of [
  ['a form that submits on change', '<form data-submit-on-change></form>', true],
  ['a dismissable details', '<details data-dismissable><summary>x</summary></details>', true],
  ['a menu button', '<button data-menu-trigger aria-controls="menu">Menu</button>', true],
  ['no marked control', '<p>Home</p>', false],
]) {
  test(`a page with ${name} ${bundled ? 'gets' : 'does not get'} the behaviors`, async () => {
    const root = await workspace({});
    try {
      await fs.writeFile(
        path.join(root, 'src', 'frontend', 'pages', 'home', 'index.html'),
        `<head></head><main>${markup}</main>`,
      );
      await build(root, 'build');
      const bundle = path.join(root, 'build', 'frontend', 'app', 'app.js');
      assert.equal(
        (await exists(bundle)) && /__WEBSTIR_BEHAVIORS_INSTALLED__/.test(await read(bundle)),
        bundled,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}
