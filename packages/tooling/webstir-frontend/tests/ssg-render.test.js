import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RenderTemplateError, frontendProvider } from '../dist/index.js';

const APP_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head><meta charset="utf-8" /><title>Blog</title></head>',
  '<body><main></main></body>',
  '</html>',
].join('\n');

const POST_HTML = [
  '<head><title data-text="title">Post</title></head>',
  '<body>',
  '  <main>',
  '    <h1 data-text="title">A post</h1>',
  '    <p class="summary" data-if="summary" data-text="summary">A summary.</p>',
  '    <ul><li data-each="tags as tag" data-text="tag">tag</li></ul>',
  '    <a href="/" data-attr-href="homeHref">Home</a>',
  '    <form method="post" action="https://forms.example/subscribe"><button type="submit">Subscribe</button></form>',
  '  </main>',
  '</body>',
].join('\n');

const POST_VIEW = `{
    definition: { name: 'post', path: '/blog/:slug', page: 'post', staticPaths: ['/blog/hello', '/blog/launch'] },
    data: z.object({ title: z.string(), summary: z.string().nullable(), tags: z.array(z.string()), homeHref: z.string() }),
    load: ({ params }) => ({ ...posts[params.slug], homeHref: '/' }),
  }`;

const POSTS = `const posts = {
  hello: { title: 'Hello <world>', summary: 'The first post.', tags: ['intro', 'news'] },
  launch: { title: 'Launch', summary: null, tags: [] },
};`;

async function createWorkspace(mode, pages) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `webstir-${mode}-render-`));
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'blog', version: '1.0.0', type: 'module', webstir: { mode } }, null, 2),
  );
  await fs.mkdir(path.join(root, 'src', 'frontend', 'app'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'frontend', 'app', 'app.html'), APP_HTML);
  for (const [name, html] of Object.entries(pages)) {
    const dir = path.join(root, 'src', 'frontend', 'pages', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), html);
  }
  return root;
}

async function writeViews(root, views, prelude = POSTS) {
  const dir = path.join(root, 'build', 'backend');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'module.js'),
    [
      `import { z } from ${JSON.stringify(import.meta.resolve('zod'))};`,
      prelude,
      `export const module = { views: [${views.join(', ')}] };`,
    ].join('\n'),
  );
}

async function publish(root) {
  for (const mode of ['build', 'publish']) {
    await frontendProvider.build({
      workspaceRoot: root,
      env: { WEBSTIR_MODULE_MODE: mode },
      incremental: false,
    });
  }
}

async function exists(file) {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

test('SSG publish writes each view path as finished HTML and drops the template and programs', async () => {
  const root = await createWorkspace('ssg', {
    home: '<main><h1>Home</h1></main>',
    post: POST_HTML,
  });
  try {
    await writeViews(root, [POST_VIEW]);
    await publish(root);
    const dist = path.join(root, 'dist', 'frontend');

    const hello = await fs.readFile(path.join(dist, 'blog', 'hello', 'index.html'), 'utf8');
    assert.match(hello, /<title>Hello &lt;world&gt;<\/title>/);
    assert.match(hello, /<h1>Hello &lt;world&gt;<\/h1>/);
    assert.match(hello, /<p class="summary">The first post.<\/p>/);
    assert.match(hello, /<ul><li>intro<\/li><li>news<\/li><\/ul>/);
    assert.match(
      hello,
      /<form method="post" action="https:\/\/forms.example\/subscribe"><button type="submit">Subscribe<\/button><\/form>/,
    );
    assert.doesNotMatch(hello, /data-(text|if|each|attr-)|data-webstir-src|_csrf/);
    assert.equal(await exists(path.join(dist, 'blog', 'hello', 'index.html.br')), true);

    const launch = await fs.readFile(path.join(dist, 'blog', 'launch', 'index.html'), 'utf8');
    assert.match(launch, /<h1>Launch<\/h1>/);
    assert.doesNotMatch(launch, /class="summary"/);
    assert.match(launch, /<ul><\/ul>/);

    assert.equal(
      await exists(path.join(dist, 'post', 'index.html')),
      false,
      'the bare template is not a page',
    );
    const programs = (await fs.readdir(dist, { recursive: true })).filter((file) =>
      file.endsWith('.program.json'),
    );
    assert.deepEqual(programs, []);
    const sitemap = await fs.readFile(path.join(dist, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /blog\/hello/);
    assert.match(sitemap, /blog\/launch/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SSG publish refuses data that does not match the view schema', async () => {
  const root = await createWorkspace('ssg', {
    home: '<main><h1>Home</h1></main>',
    post: POST_HTML,
  });
  try {
    await writeViews(root, [POST_VIEW], POSTS.replace("title: 'Launch'", 'title: 42'));
    await assert.rejects(
      publish(root),
      /view post returned data for \/blog\/launch that does not match its schema: title: Expected string, received number/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SSG publish needs the addresses a parameterized view publishes', async () => {
  const root = await createWorkspace('ssg', {
    home: '<main><h1>Home</h1></main>',
    post: POST_HTML,
  });
  try {
    await writeViews(root, [
      POST_VIEW.replace(", staticPaths: ['/blog/hello', '/blog/launch']", ''),
    ]);
    await assert.rejects(
      publish(root),
      /view post renders page 'post' at \/blog\/:slug, which names no single address; list the addresses to publish in staticPaths/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SSG publish refuses static paths that leave the site', async () => {
  const root = await createWorkspace('ssg', {
    home: '<main><h1>Home</h1></main>',
    post: POST_HTML,
  });
  try {
    await writeViews(root, [POST_VIEW.replace("'/blog/launch'", "'/blog/../../src'")]);
    await assert.rejects(
      publish(root),
      /view post lists \/blog\/\.\.\/\.\.\/src; static paths cannot contain \. or \.\. segments/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('SSG publish fails on a template with bindings that no view renders', async () => {
  const root = await createWorkspace('ssg', {
    home: '<main><h1>Home</h1></main>',
    post: POST_HTML,
  });
  try {
    await assert.rejects(publish(root), (error) => {
      assert.ok(error instanceof RenderTemplateError);
      assert.match(
        error.message,
        /src\/frontend\/pages\/post\/index.html:\d+: page 'post' has bindings, but no view renders it/,
      );
      return true;
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an SPA fails on bindings, with the file and line, and builds POST forms without them', async () => {
  const root = await createWorkspace('spa', {
    home: '<main><h1>Home</h1></main>',
    post: POST_HTML,
  });
  try {
    await assert.rejects(
      frontendProvider.build({
        workspaceRoot: root,
        env: { WEBSTIR_MODULE_MODE: 'build' },
        incremental: false,
      }),
      (error) => {
        assert.ok(error instanceof RenderTemplateError);
        assert.match(
          error.message,
          /src\/frontend\/pages\/post\/index.html:1: page 'post' has bindings, but an SPA has no server to render them/,
        );
        return true;
      },
    );
    await fs.writeFile(
      path.join(root, 'src', 'frontend', 'pages', 'post', 'index.html'),
      '<main><form method="post" action="https://forms.example/subscribe"><button>Subscribe</button></form></main>',
    );
    await frontendProvider.build({
      workspaceRoot: root,
      env: { WEBSTIR_MODULE_MODE: 'build' },
      incremental: false,
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a page <main> keeps its attributes and bindings, and a strict schema needs no flash', async () => {
  const page =
    '<main class="note" data-attr-data-tone="tone"><h1 data-text="title">Title</h1></main>';
  const view = `{
    definition: { name: 'note', path: '/notes/:slug', page: 'note', staticPaths: ['/notes/calm'] },
    data: z.object({ title: z.string(), tone: z.string() }).strict(),
    load: ({ params }) => ({ title: params.slug, tone: params.slug }),
  }`;
  const root = await createWorkspace('ssg', { home: '<main><h1>Home</h1></main>', note: page });
  try {
    await writeViews(root, [view], '');
    await publish(root);
    const html = await fs.readFile(
      path.join(root, 'dist', 'frontend', 'notes', 'calm', 'index.html'),
      'utf8',
    );
    assert.match(html, /<main class="note" data-tone="calm"><h1>calm<\/h1><\/main>/);

    await fs.writeFile(
      path.join(root, 'src', 'frontend', 'pages', 'note', 'index.html'),
      page.replace('data-attr-data-tone="tone"', 'data-if="tone"'),
    );
    await assert.rejects(
      publish(root),
      /src\/frontend\/pages\/note\/index.html:1: data-if="tone": not allowed on <main>, which every page keeps/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('the module loader sees each rebuild and survives concurrent loads', async () => {
  const { loadBackendModuleDefinition } = await import('../dist/utils/backendModule.js');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-module-load-'));
  const dir = path.join(root, 'build', 'backend');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'module.js'), "export const module = { name: 'first' };\n");
    const loads = await Promise.all(
      Array.from({ length: 5 }, () => loadBackendModuleDefinition(root)),
    );
    assert.deepEqual(
      loads.map((loaded) => loaded.name),
      Array(5).fill('first'),
    );
    await fs.writeFile(path.join(dir, 'module.js'), "export const module = { name: 'second' };\n");
    assert.equal((await loadBackendModuleDefinition(root)).name, 'second');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
