import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeRenderProgram } from '@webstir-io/module-contract/render';

import { compileRenderProgram, frontendProvider } from '../dist/index.js';

const SHELL =
  '<!DOCTYPE html><html lang="en"><head><title>Site</title></head><body><main></main></body></html>';

async function createApp({ page, islands = {}, data, files = {}, shell = SHELL }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-islands-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'site' }));
  const app = path.join(root, 'src', 'frontend', 'app');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  const islandsDir = path.join(root, 'src', 'frontend', 'islands');
  for (const dir of [app, pageDir, islandsDir]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(app, 'app.html'), shell);
  await fs.writeFile(path.join(pageDir, 'index.html'), page);
  for (const [file, source] of Object.entries(islands)) {
    await fs.writeFile(path.join(islandsDir, file), source);
  }
  for (const [file, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), source);
  }
  if (data) {
    await fs.writeFile(path.join(pageDir, 'data.ts'), data);
    await fs.writeFile(
      path.join(pageDir, 'index.ts'),
      'export async function load() { return { chart: { points: [1] } }; }\n',
    );
    const scope = path.join(root, 'node_modules', '@webstir-io');
    await fs.mkdir(scope, { recursive: true });
    await fs.symlink(
      path.resolve(import.meta.dirname, '..'),
      path.join(scope, 'webstir-frontend'),
      'dir',
    );
  }
  return root;
}

const build = (root) =>
  frontendProvider.build({
    workspaceRoot: root,
    env: { WEBSTIR_MODULE_MODE: 'build' },
    incremental: false,
  });

const PLAIN = 'export function mount(element) { element.textContent = "on"; }\n';

test('the build refuses island elements it cannot mount, with the file and line', async () => {
  const cases = [
    {
      name: 'an island with no file',
      page: '<main>\n<div data-island="chart"></div></main>',
      error: /src\/frontend\/pages\/home\/index\.html:2: data-island="chart" names no island/,
    },
    {
      name: 'an unknown load strategy',
      page: '<main><div data-island="chart" data-load="soon"></div></main>',
      islands: { 'chart.ts': PLAIN },
      error: /index\.html:1: data-load="soon" is not a load strategy/,
    },
    {
      name: 'a media strategy without a query',
      page: '<main><div data-island="chart" data-load="media"></div></main>',
      islands: { 'chart.ts': PLAIN },
      error: /data-load="media" needs a data-media query/,
    },
    {
      name: 'a Svelte island without Svelte installed',
      page: '<main><div data-island="chart"></div></main>',
      islands: { 'chart.svelte': '<p>chart</p>\n' },
      error: /island src\/frontend\/islands\/chart\.svelte needs svelte\/compiler/,
    },
    {
      name: 'a JSX island without a JSX library',
      page: '<main><div data-island="chart"></div></main>',
      islands: { 'chart.tsx': 'export default () => <p>chart</p>;\n' },
      error: /chart\.tsx is JSX, but the app has no JSX library/,
    },
    {
      name: 'an island in an included partial',
      page: '<main><div data-include="chart"></div></main>',
      files: {
        'src/frontend/app/partials/chart.html':
          '<section>\n<div data-island="nope"></div></section>',
      },
      error: /src\/frontend\/app\/partials\/chart\.html:2: data-island="nope" names no island/,
    },
    {
      name: 'an island in a Markdown page',
      page: '<main></main>',
      files: { 'src/frontend/content/intro.md': '# Intro\n\n<div data-island="nope"></div>\n' },
      error: /src\/frontend\/content\/intro\.md:\d+: data-island="nope" names no island/,
    },
    {
      name: 'two files for one island',
      page: '<main><div data-island="chart"></div></main>',
      islands: { 'chart.ts': PLAIN, 'chart.js': PLAIN },
      error:
        /chart\.js and chart\.ts are both the island "chart"|chart\.ts and chart\.js are both the island "chart"/,
    },
  ];
  for (const entry of cases) {
    const root = await createApp(entry);
    try {
      await assert.rejects(build(root), entry.error, entry.name);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test('data-props is a binding: checked against the page data and written as escaped JSON', async () => {
  const program = compileRenderProgram(
    '<main><div data-island="chart" data-props="chart"><p>…</p></div></main>',
    { page: 'home', source: 'src/frontend/pages/home/index.html' },
  );
  const html = executeRenderProgram(
    program,
    { chart: { title: '"</div><script>' } },
    {
      csrfToken: false,
    },
  );
  assert.ok(
    html.includes(
      'data-island-props="{&quot;title&quot;:&quot;\\&quot;&lt;/div&gt;&lt;script&gt;&quot;}"',
    ),
    html,
  );
  assert.doesNotMatch(html, /data-props="chart"/);
  for (const [value, message] of [
    [{ count: 1n }, /data-props="chart" needs JSON data: .*BigInt/],
    [() => {}, /data-props="chart" needs JSON data, got a function/],
  ]) {
    assert.throws(
      () => executeRenderProgram(program, { chart: value }, { csrfToken: false }),
      (error) => message.test(error.message) && /index\.html:1/.test(error.message),
    );
  }

  const root = await createApp({
    page: '<main><div data-island="chart" data-props="chrt"><p>…</p></div></main>',
    islands: { 'chart.ts': PLAIN },
    data: `import { z } from ${JSON.stringify(fileURLToPath(import.meta.resolve('zod')))};\nexport const data = z.object({ chart: z.object({ points: z.array(z.number()) }) });\nexport const initial = { chart: { points: [] } };\n`,
  });
  try {
    await assert.rejects(build(root), /data-props="chrt"/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('data-props outside an island is an error', () => {
  assert.throws(
    () =>
      compileRenderProgram('<main><div data-props="chart"></div></main>', {
        page: 'home',
        source: 'src/frontend/pages/home/index.html',
      }),
    /passes data to an island; add data-island/,
  );
});

test('a page with islands loads the islands loader; one without does not', async () => {
  const root = await createApp({
    page: '<main><div data-island="chart"><p>fallback</p></div></main>',
    // An island named like the loader, and one with a stylesheet.
    islands: {
      'chart.ts': `import './chart.css';\n${PLAIN}`,
      'chart.css': '.chart { color: red; }\n',
      'loader.ts': PLAIN,
    },
  });
  try {
    await build(root);
    const html = await fs.readFile(
      path.join(root, 'build', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    assert.match(
      html,
      /<script type="module" src="\/app\/islands\/runtime\/loader\.js" data-webstir-islands/,
    );
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(root, 'build', 'frontend', 'app', 'islands', 'islands.json'),
        'utf8',
      ),
    );
    assert.deepEqual(manifest, {
      loader: '/app/islands/runtime/loader.js',
      islands: {
        modules: { chart: '/app/islands/chart.js', loader: '/app/islands/loader.js' },
        styles: { chart: '/app/islands/chart.css' },
      },
    });
    const islandsOut = path.join(root, 'build', 'frontend', 'app', 'islands');
    assert.doesNotMatch(
      await fs.readFile(path.join(islandsOut, 'loader.js'), 'utf8'),
      /startIslands/,
    );
    assert.match(await fs.readFile(path.join(islandsOut, 'chart.css'), 'utf8'), /color: red/);

    await fs.writeFile(
      path.join(root, 'src', 'frontend', 'pages', 'home', 'index.html'),
      '<main><p>no islands</p></main>',
    );
    await build(root);
    const plain = await fs.readFile(
      path.join(root, 'build', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    assert.doesNotMatch(plain, /data-webstir-islands/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a published page, its render program and its Markdown pages load the fingerprinted loader', async () => {
  const zod = JSON.stringify(fileURLToPath(import.meta.resolve('zod')));
  const root = await createApp({
    page: '<main><h1 data-text="title"></h1><div data-island="chart" data-props="chart"></div></main>',
    shell:
      '<!DOCTYPE html><html lang="en"><head><title>Site</title></head><body><header><div data-island="chart"></div></header><main></main></body></html>',
    islands: { 'chart.ts': PLAIN },
    files: {
      // A server app whose view renders the page.
      'src/backend/index.ts': 'export {};\n',
      'build/backend/module.js': `import { z } from ${zod};\nexport const module = { views: [{ definition: { name: 'home', path: '/', page: 'home' }, data: z.object({ title: z.string(), chart: z.object({ n: z.number() }) }), load: () => ({ title: 't', chart: { n: 1 } }) }] };\n`,
      'src/frontend/content/intro.md': '# Intro\n\nHello\n',
      'src/frontend/pages/docs/index.html':
        '<head><link rel="stylesheet" href="index.css" /><script type="module" src="index.js"></script></head><main></main>',
      'src/frontend/pages/docs/index.css': 'main { display: grid; }\n',
      'src/frontend/pages/docs/index.ts': 'export {};\n',
      'src/frontend/app/app.css': 'body { margin: 0; }\n',
    },
  });
  try {
    await build(root);
    const builtContent = await fs.readFile(
      path.join(root, 'build', 'frontend', 'pages', 'docs', 'intro', 'index.html'),
      'utf8',
    );
    assert.match(builtContent, /src="\/app\/islands\/runtime\/loader\.js" data-webstir-islands/);

    await frontendProvider.build({
      workspaceRoot: root,
      env: { WEBSTIR_MODULE_MODE: 'publish' },
      incremental: false,
    });
    const dist = path.join(root, 'dist', 'frontend');
    const { loader } = JSON.parse(
      await fs.readFile(path.join(dist, 'app', 'islands', 'islands.json'), 'utf8'),
    );
    assert.match(loader, /^\/app\/islands\/runtime\/loader-[A-Z0-9]+\.js$/);
    const outputs = [
      await fs.readFile(path.join(dist, 'pages', 'home', 'index.program.json'), 'utf8'),
      await fs.readFile(path.join(dist, 'pages', 'home', 'index.html'), 'utf8'),
      await fs.readFile(path.join(dist, 'pages', 'docs', 'intro', 'index.html'), 'utf8'),
    ];
    for (const output of outputs) {
      assert.ok(output.includes(loader), output.slice(0, 400));
      assert.doesNotMatch(output, /runtime\/loader\.js/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
