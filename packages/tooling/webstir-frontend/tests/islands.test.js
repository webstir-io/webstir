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

async function createApp({ page, islands = {}, data }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-islands-'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'site' }));
  const app = path.join(root, 'src', 'frontend', 'app');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  const islandsDir = path.join(root, 'src', 'frontend', 'islands');
  for (const dir of [app, pageDir, islandsDir]) await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(app, 'app.html'), SHELL);
  await fs.writeFile(path.join(pageDir, 'index.html'), page);
  for (const [file, source] of Object.entries(islands)) {
    await fs.writeFile(path.join(islandsDir, file), source);
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
    islands: { 'chart.ts': PLAIN },
  });
  try {
    await build(root);
    const html = await fs.readFile(
      path.join(root, 'build', 'frontend', 'pages', 'home', 'index.html'),
      'utf8',
    );
    assert.match(
      html,
      /<script type="module" src="\/app\/islands\/loader\.js" data-webstir-islands/,
    );
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(root, 'build', 'frontend', 'app', 'islands', 'islands.json'),
        'utf8',
      ),
    );
    assert.deepEqual(manifest, {
      loader: '/app/islands/loader.js',
      islands: { chart: '/app/islands/chart.js' },
    });

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
