import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RenderTemplateError, frontendProvider, validateRenderPrograms } from '../dist/index.js';

const zodPath = fileURLToPath(import.meta.resolve('zod'));

const TEMPLATE = `<!DOCTYPE html>
<html><head><title>Items</title></head>
<body><main>
  <h1 data-text="title">Items</h1>
  <ul><li data-each="items as item"><a data-attr-href="item.href" data-text="item.name">Item</a></li></ul>
  <p data-if="!items">Nothing yet.</p>
</main>
<script type="module" src="index.js" data-webstir-load></script>
</body></html>`;

const SCRIPT = `export async function load() {
  return { title: 'Items', items: [{ name: 'One', href: '/one/' }] };
}
export function setup() {}
`;

const DATA = `import { z } from ${JSON.stringify(zodPath)};
export const data = z.object({
  title: z.string(),
  items: z.array(z.object({ name: z.string(), href: z.string() })),
});
export const initial = { title: 'Items', items: [] };
`;

async function createWorkspace({ mode = 'ssg', template = TEMPLATE, data = DATA } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-browser-render-'));
  const app = path.join(root, 'src', 'frontend', 'app');
  const page = path.join(root, 'src', 'frontend', 'pages', 'items');
  await fs.mkdir(app, { recursive: true });
  await fs.mkdir(page, { recursive: true });
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', type: 'module', webstir: { mode } }),
  );
  await fs.writeFile(
    path.join(app, 'app.html'),
    '<!DOCTYPE html><html><head><title>App</title></head><body><main></main></body></html>',
  );
  await fs.writeFile(path.join(page, 'index.html'), template);
  await fs.writeFile(path.join(page, 'index.ts'), SCRIPT);
  if (data !== null) await fs.writeFile(path.join(page, 'data.ts'), data);
  // A real app depends on the frontend package; the page bundle imports its runtime.
  const scope = path.join(root, 'node_modules', '@webstir-io');
  await fs.mkdir(scope, { recursive: true });
  await fs.symlink(
    path.resolve(import.meta.dirname, '..'),
    path.join(scope, 'webstir-frontend'),
    'dir',
  );
  return root;
}

function build(root, mode = 'build') {
  return frontendProvider.build({
    workspaceRoot: root,
    env: { WEBSTIR_MODULE_MODE: mode },
    incremental: false,
  });
}

async function pageBundle(root, mode) {
  // Publish serves pages from the site root; build keeps them under pages/.
  const dir =
    mode === 'publish'
      ? path.join(root, 'dist', 'frontend', 'items')
      : path.join(root, 'build', 'frontend', 'pages', 'items');
  const file = (await fs.readdir(dir)).find((name) => /^index(-[^.]+)?\.js$/.test(name));
  assert.ok(file, `expected a page bundle in ${dir}`);
  return await fs.readFile(path.join(dir, file), 'utf8');
}

// A page with a data.ts ships its compiled template inside its own script, next to its load and
// setup, in both build and publish; the schema stays at build time.
for (const mode of ['build', 'publish']) {
  test(`a browser page's bundle carries its render program (${mode})`, async () => {
    const root = await createWorkspace();
    try {
      await build(root, mode);
      const bundle = await pageBundle(root, mode);
      assert.match(bundle, /__webstirRenderProgram/);
      assert.match(bundle, /"op":\s*"each"|op:\s*"each"/);
      assert.match(bundle, /load/);
      assert.match(bundle, /setup/);
      assert.doesNotMatch(bundle, /ZodError|zod/i, 'the schema is build-time only');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

// What the build refuses for a browser page, each with the file (and line) to fix.
const refusals = [
  {
    name: 'a binding the schema does not have',
    workspace: { template: TEMPLATE.replace('data-text="title"', 'data-text="titel"') },
    error:
      /src\/frontend\/pages\/items\/index\.html:4: data-text="titel": the view data has no `titel`; it has `items`, `title` \(page 'items'\)/,
  },
  {
    name: 'a data.ts without a data schema',
    workspace: { data: 'export const initial = {};\n' },
    error:
      /src\/frontend\/pages\/items\/data\.ts:1: src\/frontend\/pages\/items\/data\.ts must export `data`/,
  },
  {
    name: 'a data.ts without first-load data',
    workspace: { data: DATA.replace(/export const initial[^\n]*\n/, '') },
    error: /data\.ts must export `initial`, the data the page shows before `load` has run/,
  },
  {
    name: 'first-load data that does not match the schema',
    workspace: { data: DATA.replace('items: [] }', "items: 'none' }") },
    error: /data\.ts exports `initial` that does not match `data`: items:/,
  },
  {
    name: 'a binding outside <main> and <title>',
    workspace: {
      template: TEMPLATE.replace(
        '<title>Items</title>',
        '<title>Items</title><meta name="description" data-attr-content="title">',
      ),
    },
    error:
      /src\/frontend\/pages\/items\/index\.html:2: page 'items' renders in the browser, which replaces only its <main> and <title>/,
  },
  ...['ssg', 'full'].map((mode) => ({
    name: `a POST form (${mode})`,
    workspace: {
      mode,
      template: TEMPLATE.replace(
        '</main>',
        '<form method="post" action="/items/"><button>Add</button></form></main>',
      ),
    },
    error: /page 'items' renders in the browser, so it can't have a POST form/,
  })),
];

for (const { name, workspace, error } of refusals) {
  test(`the build refuses ${name}`, async () => {
    const root = await createWorkspace(workspace);
    try {
      await assert.rejects(build(root), (thrown) => {
        assert.ok(
          thrown instanceof RenderTemplateError || /RenderTemplateError/.test(thrown.name),
          String(thrown),
        );
        assert.match(thrown.message, error);
        return true;
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

// The first load shows the page rendered with its initial data: no bindings reach the browser,
// and no program is written for the server.
test("a browser page's first load is rendered from its initial data", async () => {
  const root = await createWorkspace();
  try {
    await build(root);
    const pageDir = path.join(root, 'build', 'frontend', 'pages', 'items');
    const html = await fs.readFile(path.join(pageDir, 'index.html'), 'utf8');
    assert.match(html, /<h1>Items<\/h1>/);
    assert.match(html, /<p>Nothing yet\.<\/p>/);
    assert.doesNotMatch(html, /data-(text|if|each|attr-|webstir-src)/);
    await assert.rejects(fs.access(path.join(pageDir, 'index.program.json')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// An SPA can have bindings only on pages that render in the browser.
for (const withData of [true, false]) {
  test(`an SPA page with bindings ${withData ? 'builds with' : 'fails without'} a data.ts`, async () => {
    const root = await createWorkspace({ mode: 'spa', data: withData ? DATA : null });
    try {
      const run = build(root);
      if (withData) {
        await run;
      } else {
        await assert.rejects(
          run,
          /page 'items' has bindings, but an SPA has no server to render them/,
        );
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

test('a page cannot render in the browser and on the server at once', async () => {
  const root = await createWorkspace();
  try {
    await build(root);
    const backend = path.join(root, 'build', 'backend');
    await fs.mkdir(backend, { recursive: true });
    await fs.writeFile(
      path.join(backend, 'module.js'),
      `import { z } from ${JSON.stringify(zodPath)};
export const module = {
  manifest: { contractVersion: '1', name: 'fixture', version: '1.0.0', kind: 'backend' },
  views: [{ definition: { name: 'itemsPage', path: '/items/', page: 'items' }, data: z.object({}), load: () => ({}) }],
};
`,
    );
    await assert.rejects(
      validateRenderPrograms({
        workspaceRoot: root,
        pagesRoot: path.join(root, 'build', 'frontend', 'pages'),
      }),
      /page 'items' renders in the browser \(it has src\/frontend\/pages\/items\/data\.ts\), and view itemsPage also renders it; keep one/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
