import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { frontendProvider } from '../dist/index.js';

async function createWorkspace({
  shellScript = true,
  pageScript = true,
  missing = false,
  bodyClass = '',
  shellTagOverride = null,
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-inline-scripts-'));
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const scriptsDir = path.join(appDir, 'scripts');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.mkdir(pageDir, { recursive: true });

  const shellTag =
    shellTagOverride ??
    (shellScript
      ? `<script data-webstir-inline src="${missing ? './scripts/nope.ts' : './scripts/first-paint.ts'}"></script>`
      : '');
  await fs.writeFile(
    path.join(appDir, 'app.html'),
    `<!doctype html><html><head>${shellTag}<link rel="stylesheet" href="/app/app.css"></head><body><main></main></body></html>`,
  );
  await fs.writeFile(path.join(appDir, 'app.css'), 'body { color: #111; }');
  await fs.writeFile(
    path.join(scriptsDir, 'first-paint.ts'),
    [
      "import { paint } from './paint.js';",
      'const firstPaintMoment: number = Date.now();',
      'paint(firstPaintMoment);',
      '',
    ].join('\n'),
  );
  await fs.writeFile(
    path.join(scriptsDir, 'paint.ts'),
    [
      'export function paint(moment: number): void {',
      "  document.documentElement.dataset.painted = moment < 1 ? 'never' : 'yes';",
      "  if ('</script>'.length > 0) document.documentElement.dataset.closing = 'kept';",
      '}',
      '',
    ].join('\n'),
  );

  const pageTag = pageScript ? '<script data-webstir-inline src="./page-paint.ts"></script>' : '';
  const bodyOpen = bodyClass ? `<body class="${bodyClass}">` : '';
  const bodyClose = bodyClass ? '</body>' : '';
  await fs.writeFile(
    path.join(pageDir, 'index.html'),
    `<head>${pageTag}<link rel="stylesheet" href="index.css"></head>${bodyOpen}<main>Home</main>${bodyClose}`,
  );
  await fs.writeFile(path.join(pageDir, 'index.css'), '@import "@app/app.css";');
  await fs.writeFile(
    path.join(pageDir, 'page-paint.ts'),
    "const pagePaintMarker: string = 'home';\ndocument.documentElement.dataset.page = pagePaintMarker;\n",
  );
  return root;
}

async function build(workspace, mode) {
  return frontendProvider.build({
    workspaceRoot: workspace,
    env: { WEBSTIR_MODULE_MODE: mode },
    incremental: false,
  });
}

function scriptBodies(html) {
  return [...html.matchAll(/<script data-webstir-inline="([^"]+)">([\s\S]*?)<\/script>/g)].map(
    (match) => ({ source: match[1], code: match[2] }),
  );
}

test('build bundles inline scripts from the shell and the page into the document head', async () => {
  const workspace = await createWorkspace();
  try {
    await build(workspace, 'build');
    const html = await fs.readFile(
      path.join(workspace, 'build', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    const scripts = scriptBodies(html);
    assert.deepEqual(
      scripts.map((script) => script.source),
      ['src/frontend/app/scripts/first-paint.ts', 'src/frontend/pages/home/page-paint.ts'],
    );
    // Development keeps the code readable and bundles imports in.
    assert.match(scripts[0].code, /firstPaintMoment/);
    assert.match(scripts[0].code, /dataset\.painted/);
    assert.match(scripts[1].code, /pagePaintMarker/);
    // No src survives, and the tag sits before the stylesheet.
    assert.doesNotMatch(html, /data-webstir-inline[^>]*src=/);
    assert.ok(html.indexOf('data-webstir-inline') < html.indexOf('rel="stylesheet"'));
    // A closing tag inside the bundle cannot end the inline script early.
    assert.match(scripts[0].code, /<\\\/script>/);
    assert.doesNotMatch(scripts[0].code, /<\/script>/);
    // The comparison operator was not entity-encoded.
    assert.match(scripts[0].code, /moment < 1/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('publish bundles inline scripts again, minified, from the recorded source', async () => {
  const workspace = await createWorkspace();
  try {
    await build(workspace, 'build');
    await build(workspace, 'publish');
    const html = await fs.readFile(
      path.join(workspace, 'dist', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    const scripts = scriptBodies(html);
    assert.equal(scripts.length, 2);
    assert.doesNotMatch(scripts[0].code, /firstPaintMoment/);
    assert.match(scripts[0].code, /dataset\.painted/);
    assert.doesNotMatch(scripts[0].code, /\n/);
    assert.doesNotMatch(scripts[1].code, /pagePaintMarker/);
    assert.match(scripts[1].code, /dataset\.page/);
    assert.doesNotMatch(html, /data-webstir-inline[^>]*src=/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('a missing inline script source fails the build with the referencing file named', async () => {
  const workspace = await createWorkspace({ missing: true, pageScript: false });
  try {
    await assert.rejects(build(workspace, 'build'), (error) => {
      assert.match(error.message, /Inline script source not found/);
      assert.match(error.message, /nope\.ts/);
      assert.match(error.message, /src[\\/]frontend[\\/]app[\\/]app\.html/);
      return true;
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('pages without inline scripts are untouched', async () => {
  const workspace = await createWorkspace({ shellScript: false, pageScript: false });
  try {
    await build(workspace, 'build');
    const html = await fs.readFile(
      path.join(workspace, 'build', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    assert.doesNotMatch(html, /data-webstir-inline/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('a page with an inline script keeps its body class through the merge', async () => {
  const workspace = await createWorkspace({ bodyClass: 'page-home' });
  try {
    await build(workspace, 'build');
    const html = await fs.readFile(
      path.join(workspace, 'build', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    assert.match(html, /<body class="page-home">/);
    assert.equal(scriptBodies(html).length, 2);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('attributes other than src and type are carried onto the inlined tag', async () => {
  const workspace = await createWorkspace({
    pageScript: false,
    shellTagOverride:
      '<script id="first-paint" nonce="n0nce" data-purpose="pre-paint" type="module" data-webstir-inline src="./scripts/first-paint.ts"></script>',
  });
  try {
    await build(workspace, 'build');
    const built = await fs.readFile(
      path.join(workspace, 'build', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    const builtTag = built.match(/<script[^>]*data-webstir-inline[^>]*>/)[0];
    assert.match(builtTag, /\bid="first-paint"/);
    assert.match(builtTag, /\bnonce="n0nce"/);
    assert.match(builtTag, /\bdata-purpose="pre-paint"/);
    assert.match(builtTag, /\bdata-webstir-inline="src\/frontend\/app\/scripts\/first-paint\.ts"/);
    assert.doesNotMatch(builtTag, /\bsrc=/);
    assert.doesNotMatch(builtTag, /\btype=/);

    await build(workspace, 'publish');
    const published = await fs.readFile(
      path.join(workspace, 'dist', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    const publishedTag = published.match(/<script[^>]*data-webstir-inline[^>]*>/)[0];
    assert.match(publishedTag, /\bid="first-paint"/);
    assert.match(publishedTag, /\bnonce="n0nce"/);
    assert.doesNotMatch(publishedTag, /\bsrc=/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('a commented-out inline tag is left alone and a data-src attribute is not a source', async () => {
  const workspace = await createWorkspace({
    pageScript: false,
    shellTagOverride: [
      '<!-- <script data-webstir-inline src="./scripts/nope.ts"></script> -->',
      '<script data-webstir-inline data-src="./scripts/nope.ts"></script>',
      '<script data-webstir-inline src="./scripts/first-paint.ts"></script>',
    ].join(''),
  });
  try {
    await build(workspace, 'build');
    const html = await fs.readFile(
      path.join(workspace, 'build', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    assert.match(
      html,
      /<!-- <script data-webstir-inline src="\.\/scripts\/nope\.ts"><\/script> -->/,
    );
    // The tag without a source is passed through untouched (the merge step
    // serializes its bare attribute as data-webstir-inline="").
    assert.match(
      html,
      /<script data-webstir-inline(?:="")? data-src="\.\/scripts\/nope\.ts"><\/script>/,
    );
    assert.equal(scriptBodies(html).length, 1);
    assert.match(scriptBodies(html)[0].code, /firstPaintMoment/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
