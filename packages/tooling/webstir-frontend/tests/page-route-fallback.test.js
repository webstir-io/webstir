import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { frontendProvider } from '../dist/index.js';

const shell = (htmlAttributes = '') =>
  `<!DOCTYPE html><html lang="en"${htmlAttributes}><head><meta charset="utf-8" /><title>Site</title></head><body><main></main></body></html>`;

async function createStaticApp({ pages, views = [], htmlAttributes = '', webstir = {} }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-page-route-fallback-'));
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'site',
      type: 'module',
      webstir: { ...webstir, moduleManifest: { views } },
    }),
  );
  await fs.mkdir(path.join(root, 'src', 'frontend', 'app'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'frontend', 'app', 'app.html'), shell(htmlAttributes));
  for (const [name, html] of Object.entries(pages)) {
    const dir = path.join(root, 'src', 'frontend', 'pages', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'index.html'), html);
  }
  return root;
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

const read = (root, ...parts) => fs.readFile(path.join(root, 'dist', 'frontend', ...parts), 'utf8');
const exists = (root, ...parts) =>
  fs.access(path.join(root, 'dist', 'frontend', ...parts)).then(
    () => true,
    () => false,
  );

test('a page a view renders at publish gets no runtime fallback', async () => {
  const root = await createStaticApp({
    pages: {
      home: '<main><h1>Home</h1></main>',
      post: '<head><title data-text="title">Post</title></head><body><main><h1 data-text="title">Post</h1></main></body>',
    },
    views: [{ name: 'post', path: '/blog/:slug', page: 'post' }],
  });
  try {
    const dir = path.join(root, 'build', 'backend');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'module.js'),
      `import { z } from ${JSON.stringify(import.meta.resolve('zod'))};
export const module = { views: [{
  definition: { name: 'post', path: '/blog/:slug', page: 'post', staticPaths: ['/blog/hello'] },
  data: z.object({ title: z.string() }),
  load: ({ params }) => ({ title: params.slug }),
}] };
`,
    );
    await publish(root);

    assert.match(await read(root, 'blog', 'hello', 'index.html'), /hello/);
    assert.equal(await exists(root, '_redirects'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a runtime route's 404.html keeps the site's base path when the app has no 404 page", async () => {
  const root = await createStaticApp({
    pages: { home: '<main><h1>Home</h1></main>', items: '<main><h1>Item</h1></main>' },
    views: [{ name: 'item', path: '/items/:id', page: 'items' }],
    htmlAttributes: ' data-webstir-base="/project"',
  });
  try {
    await publish(root);

    assert.equal(await read(root, '_redirects'), '/items/:id /items/ 200\n');
    const notFound = await read(root, '404.html');
    assert.match(notFound, /var base = "\/project";/);
    assert.match(notFound, /\["\/items\/:id","\/items\/"\]/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the app's 404 page is the site's /404.html, or what its router shows for other addresses", async () => {
  for (const views of [[], [{ name: 'item', path: '/items/:id', page: 'items' }]]) {
    const root = await createStaticApp({
      pages: {
        home: '<main><h1>Home</h1></main>',
        items: '<main><h1>Item</h1></main>',
        404: '<main><h1>Lost at sea</h1></main>',
      },
      views,
    });
    try {
      await publish(root);

      const notFound = await read(root, '404.html');
      if (views.length === 0) {
        assert.match(notFound, /Lost at sea/);
      } else {
        // A router with no scripts of its own, which loads the 404 page for other addresses.
        assert.match(notFound, /var notFoundPage = "\/404\/";/);
        assert.match(notFound, /\["\/items\/:id","\/items\/"\]/);
        assert.doesNotMatch(notFound, /<script[^>]+src=/);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test('a fixed address a view routes to is a page like any other: aliased and in the sitemap', async () => {
  const root = await createStaticApp({
    pages: { home: '<main><h1>Home</h1></main>', deals: '<main><h1>Deals</h1></main>' },
    views: [{ name: 'today', path: '/deals/today', page: 'deals' }],
    webstir: { siteUrl: 'https://example.test', trailingSlash: false },
  });
  try {
    await publish(root);

    assert.match(await read(root, 'deals', 'today', 'index.html'), /Deals/);
    assert.match(await read(root, 'deals', 'today.html'), /Deals/);
    assert.match(await read(root, 'sitemap.xml'), /https:\/\/example\.test\/deals\/today/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
