import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  RenderTemplateError,
  compileRenderProgram,
  frontendProvider,
  prepareTemplateSource,
  validateRenderProgram,
  validateRenderPrograms,
} from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, 'fixtures', 'render-clients');
const CLIENTS_SOURCE = 'src/frontend/pages/clients/index.html';
const SIDEBAR_SOURCE = 'src/frontend/app/partials/sidebar.html';

const clientsData = z.object({
  nav: z.object({
    proposals: z.literal('page').nullable(),
    clients: z.object({ current: z.literal('page').nullable() }).nullable(),
  }),
  clients: z.array(z.object({ name: z.string(), href: z.string() })),
  create: z.object({
    open: z.boolean(),
    values: z.object({ name: z.string().optional(), slug: z.string().optional() }),
    issues: z.object({
      form: z.string().optional(),
      name: z.string().optional(),
      slug: z.string().optional(),
    }),
  }),
});

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-render-'));
  await fs.cp(fixtureRoot, root, { recursive: true });
  return root;
}

async function editClientsPage(root, from, to) {
  const file = path.join(root, CLIENTS_SOURCE);
  const html = await fs.readFile(file, 'utf8');
  assert.ok(html.includes(from), `fixture should contain ${from}`);
  await fs.writeFile(file, html.replace(from, to), 'utf8');
}

async function writeBackendModule(root, dataSource) {
  const zodUrl = import.meta.resolve('zod');
  const dir = path.join(root, 'build', 'backend');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'module.js'),
    [
      `import { z } from ${JSON.stringify(zodUrl)};`,
      'export const module = {',
      "  manifest: { contractVersion: '1', name: 'fixture', version: '1.0.0', kind: 'backend' },",
      '  views: [{',
      "    definition: { name: 'clientsPage', path: '/clients/', page: 'clients' },",
      `    data: ${dataSource},`,
      '    load: () => ({}),',
      '  }],',
      '};',
    ].join('\n'),
    'utf8',
  );
}

const CLIENTS_SCHEMA_SOURCE = `z.object({
  nav: z.object({
    proposals: z.literal('page').nullable(),
    clients: z.object({ current: z.literal('page').nullable() }).nullable(),
  }),
  clients: z.array(z.object({ name: z.string(), href: z.string() })),
  create: z.object({
    open: z.boolean(),
    values: z.object({ name: z.string().optional(), slug: z.string().optional() }),
    issues: z.object({ form: z.string().optional(), name: z.string().optional(), slug: z.string().optional() }),
  }),
})`;

async function buildWorkspace(root) {
  await frontendProvider.build({
    workspaceRoot: root,
    env: { WEBSTIR_MODULE_MODE: 'build' },
    incremental: false,
  });
  const programPath = path.join(
    root,
    'build',
    'frontend',
    'pages',
    'clients',
    'index.program.json',
  );
  return JSON.parse(await fs.readFile(programPath, 'utf8'));
}

async function compileSource(root, html, file = CLIENTS_SOURCE) {
  const filePath = path.join(root, file);
  const prepared = await prepareTemplateSource(html, filePath, {
    workspaceRoot: root,
    partialsRoot: path.join(root, 'src', 'frontend', 'app', 'partials'),
  });
  return compileRenderProgram(prepared, { page: 'clients', source: file });
}

function collectOps(nodes, found = []) {
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    found.push(node);
    if (node.body) collectOps(node.body, found);
  }
  return found;
}

function staticChunks(nodes, found = []) {
  for (const node of nodes) {
    if (typeof node === 'string') found.push(node);
    else if (node.body) staticChunks(node.body, found);
  }
  return found;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isFalsy(value) {
  return (
    value == null ||
    value === false ||
    value === '' ||
    value === 0 ||
    (Array.isArray(value) && value.length === 0)
  );
}

function renderForTest(nodes, data, scopes = []) {
  const read = (p) =>
    p.keys.reduce((value, key) => value?.[key], p.scope === -1 ? data : scopes[p.scope]);
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') out += node;
    else if (node.op === 'csrf') out += '<input type="hidden" name="_csrf" value="TOKEN">';
    else if (node.op === 'text') out += escapeHtml(read(node.path) ?? '');
    else if (node.op === 'attr') {
      const value = read(node.path);
      if (value === true) out += ` ${node.name}`;
      else if (value !== false && value != null) out += ` ${node.name}="${escapeHtml(value)}"`;
    } else if (node.op === 'if') {
      if (isFalsy(read(node.path)) === node.negate) out += renderForTest(node.body, data, scopes);
    } else if (node.op === 'each') {
      for (const item of read(node.path) ?? [])
        out += renderForTest(node.body, data, [...scopes, item]);
    }
  }
  return out;
}

test('the clients page compiles through the provider build with partials and CSRF', async () => {
  const root = await createWorkspace();
  const program = await buildWorkspace(root);

  assert.equal(program.version, 1);
  assert.equal(program.page, 'clients');
  assert.equal(program.source, CLIENTS_SOURCE);

  const ops = collectOps(program.nodes);
  assert.equal(ops.filter((op) => op.op === 'csrf').length, 2, 'sign-out and create forms');

  const each = ops.find((op) => op.op === 'each');
  assert.deepEqual(each.path, { source: 'clients', scope: -1, keys: ['clients'] });
  assert.deepEqual(each.loc, { file: CLIENTS_SOURCE, line: 15 });
  const name = ops.find((op) => op.op === 'text' && op.path.source === 'client.name');
  assert.deepEqual(name.path, { source: 'client.name', scope: 0, keys: ['name'] });
  assert.deepEqual(name.loc, { file: CLIENTS_SOURCE, line: 16 });

  const href = ops.find((op) => op.op === 'attr' && op.name === 'href');
  assert.equal(href.url, true);
  const current = ops.find((op) => op.op === 'attr' && op.path.source === 'nav.clients.current');
  assert.equal(current.name, 'aria-current');
  assert.equal(current.url, false);
  assert.deepEqual(current.loc, { file: SIDEBAR_SOURCE, line: 13 });

  for (const chunk of staticChunks(program.nodes)) {
    assert.doesNotMatch(chunk, /data-(text|if|each|include|attr-|webstir-src)/);
  }

  const html = renderForTest(program.nodes, {
    nav: { proposals: null, clients: { current: 'page' } },
    clients: [
      { name: 'Acme <Logistics>', href: '/clients/acme/' },
      { name: 'Birch', href: '/clients/birch/' },
    ],
    create: { open: true, values: { name: 'Ne"w' }, issues: { name: 'Too short.' } },
  });
  assert.match(html, /<a class="client-row" href="\/clients\/acme\/">/);
  assert.match(html, /Acme &lt;Logistics&gt;/);
  assert.match(html, /<details class="management-panel" id="new-client" open>/);
  assert.match(html, /value="Ne&quot;w"/);
  assert.match(html, /Too short\./);
  assert.doesNotMatch(html, /Something went wrong/);
  assert.doesNotMatch(html, /No clients yet/);
  assert.match(html, /href="\/clients\/" aria-current="page">/);
  assert.match(html, /<form method="post" action="\/sign-out\/"><input type="hidden" name="_csrf"/);
  assert.match(html, /<title>Clients · Sqware Logics<\/title>/);
  assert.equal((html.match(/class="client-row"/g) ?? []).length, 2);

  const builtHtml = await fs.readFile(
    path.join(root, 'build', 'frontend', 'pages', 'clients', 'index.html'),
    'utf8',
  );
  assert.match(builtHtml, /portal-sidebar-header/, 'partial is inlined into the built page');
});

test('the clients page validates against its view schema', async () => {
  const root = await createWorkspace();
  const program = await buildWorkspace(root);
  assert.deepEqual(validateRenderProgram(program, clientsData, 'clientsPage'), []);

  await writeBackendModule(root, CLIENTS_SCHEMA_SOURCE);
  await validateRenderPrograms({
    workspaceRoot: root,
    pagesRoot: path.join(root, 'build', 'frontend', 'pages'),
  });
});

test('a misspelled path fails with file and line', async () => {
  const root = await createWorkspace();
  await editClientsPage(root, 'data-text="client.name"', 'data-text="client.nmae"');
  await buildWorkspace(root);
  await writeBackendModule(root, CLIENTS_SCHEMA_SOURCE);

  await assert.rejects(
    validateRenderPrograms({
      workspaceRoot: root,
      pagesRoot: path.join(root, 'build', 'frontend', 'pages'),
    }),
    (error) => {
      assert.ok(error instanceof RenderTemplateError);
      assert.equal(
        error.message,
        [
          'Template error:',
          `${CLIENTS_SOURCE}:16: data-text="client.nmae": \`client\` has no \`nmae\`; it has \`href\`, \`name\` (view clientsPage)`,
        ].join('\n'),
      );
      return true;
    },
  );
});

test('a misspelled path inside a partial reports the partial file', async () => {
  const root = await createWorkspace();
  const partial = path.join(root, SIDEBAR_SOURCE);
  const html = await fs.readFile(partial, 'utf8');
  await fs.writeFile(partial, html.replace('nav.clients.current', 'nav.client.current'), 'utf8');
  const program = await buildWorkspace(root);

  const issues = validateRenderProgram(program, clientsData, 'clientsPage');
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].loc, { file: SIDEBAR_SOURCE, line: 13 });
  assert.match(issues[0].message, /`nav` has no `client`; it has `clients`, `proposals`/);
});

test('a page with bindings that no view renders is an error', async () => {
  const root = await createWorkspace();
  await buildWorkspace(root);
  await writeBackendModule(root, CLIENTS_SCHEMA_SOURCE);
  const moduleFile = path.join(root, 'build', 'backend', 'module.js');
  const source = await fs.readFile(moduleFile, 'utf8');
  await fs.writeFile(moduleFile, source.replace(", page: 'clients'", ''), 'utf8');

  await assert.rejects(
    validateRenderPrograms({
      workspaceRoot: root,
      pagesRoot: path.join(root, 'build', 'frontend', 'pages'),
    }),
    /src\/frontend\/app\/partials\/sidebar\.html:9: page 'clients' has bindings, but no view renders it/,
  );
});

test('schema checks cover each, text, attributes and the framework flash', async () => {
  const root = await createWorkspace();
  const program = await compileSource(
    root,
    [
      '<head><title data-text="title">T</title></head>',
      '<main>',
      '<p data-each="flash as note" data-attr-data-tone="note.level" data-text="note.message"></p>',
      '<table><tbody>',
      '<tr data-each="table.rows as row"><td data-each="row as cell" data-text="cell"></td></tr>',
      '</tbody></table>',
      '<ul data-each="sections as section"><li data-each="section.items as section" data-text="section"></li></ul>',
      '<p data-each="title as letter"></p>',
      '<p data-text="table"></p>',
      '<a data-attr-href="table.rows"></a>',
      '<p data-text="sections"></p>',
      '<p data-if="missing"></p>',
      '<p data-text="flag"></p>',
      '<input data-attr-disabled="flag" />',
      '<p data-each="tags as tag"></p>',
      '</main>',
    ].join('\n'),
  );

  const schema = z.object({
    title: z.string(),
    flag: z.boolean(),
    table: z.object({ rows: z.array(z.array(z.string())) }),
    sections: z.array(z.object({ items: z.array(z.string()) })),
    tags: z.set(z.string()),
  });
  const messages = validateRenderProgram(program, schema, 'fixture').map(
    (issue) => `${issue.loc.line}: ${issue.message.replace(' (view fixture)', '')}`,
  );
  assert.deepEqual(messages, [
    '8: data-each="title as letter": `title` needs an array, but it can be a string',
    '9: data-text="table": `table` needs a string or number, but it can be an object',
    '10: data-attr-href="table.rows": `table.rows` needs a string, number or boolean, but it can be an array',
    '11: data-text="sections": `sections` needs a string or number, but it can be an array',
    '12: data-if="missing": the view data has no `missing`; it has `flag`, `sections`, `table`, `tags`, `title`',
    '13: data-text="flag": `flag` needs a string or number, but it can be a boolean',
    '15: data-each="tags as tag": `tags` needs an array, but it can be a set (use z.array)',
  ]);

  const inner = collectOps(program.nodes).find(
    (op) => op.op === 'text' && op.path.source === 'section',
  );
  assert.deepEqual(inner.path, { source: 'section', scope: 1, keys: [] });
});

test('unions, optional and nullable wrappers resolve through every member', async () => {
  const root = await createWorkspace();
  const program = await compileSource(
    root,
    [
      '<head></head><main>',
      '<div data-each="blocks as block">',
      '<p data-if="block.prose" data-text="block.prose.heading"></p>',
      '<p data-text="block.cards.count"></p>',
      '<p data-text="block.table.title"></p>',
      '</div>',
      '</main>',
    ].join('\n'),
  );
  const schema = z.object({
    blocks: z
      .array(
        z.object({
          prose: z.object({ heading: z.string().nullable() }).nullable(),
          cards: z.union([z.null(), z.object({ count: z.number() })]).optional(),
          table: z.object({ columns: z.array(z.string()) }).nullable(),
        }),
      )
      .optional(),
  });
  const messages = validateRenderProgram(program, schema, 'fixture').map((issue) => issue.message);
  assert.deepEqual(messages, [
    'data-text="block.table.title": `block.table` has no `title`; it has `columns` (view fixture)',
  ]);
});

test('structural mistakes fail compilation with file and line', async () => {
  const root = await createWorkspace();
  const cases = [
    ['<input data-text="name" />', 'data-text="name": <input> has no content to replace'],
    [
      '<a data-attr-onclick="name"></a>',
      'data-attr-onclick="name": event handler attributes cannot be bound',
    ],
    ['<p data-each="items"></p>', 'data-each="items": expected `items as item`'],
    ['<p data-text="a..b"></p>', 'data-text="a..b": `a..b` is not a path'],
    ['<script data-text="name"></script>', 'data-text="name": not allowed on <script>'],
    [
      '<p data-text="name"><span data-text="other"></span></p>',
      'data-text="name": replaces the element content, so bindings inside it would never render',
    ],
    [
      '<form method="post" data-attr-method="m"></form>',
      'data-attr-method="m": form method must be written in the HTML',
    ],
    [
      '<div data-include="missing"></div>',
      'data-include="missing": src/frontend/app/partials/missing.html does not exist',
    ],
    ['<div data-include="../secrets"></div>', 'data-include="../secrets": not a partial name'],
  ];

  for (const [markup, expected] of cases) {
    const html = `<head></head>\n<main>\n${markup}\n</main>`;
    await assert.rejects(compileSource(root, html), (error) => {
      assert.ok(error instanceof RenderTemplateError, `${markup} should raise a template error`);
      assert.equal(error.issues.length, 1, markup);
      assert.equal(error.issues[0].loc.file, CLIENTS_SOURCE, markup);
      assert.equal(error.issues[0].loc.line, 3, markup);
      assert.ok(
        error.issues[0].message.startsWith(expected),
        `${markup}\nexpected: ${expected}\nactual:   ${error.issues[0].message}`,
      );
      return true;
    });
  }
});

test('partials that include each other are rejected', async () => {
  const root = await createWorkspace();
  const partials = path.join(root, 'src', 'frontend', 'app', 'partials');
  await fs.writeFile(path.join(partials, 'a.html'), '<div data-include="b"></div>', 'utf8');
  await fs.writeFile(path.join(partials, 'b.html'), '<div data-include="a"></div>', 'utf8');

  await assert.rejects(
    compileSource(root, '<head></head><main><div data-include="a"></div></main>'),
    /src\/frontend\/app\/partials\/b\.html:1: data-include="a": partials include each other \(src\/frontend\/pages\/clients\/index\.html -> src\/frontend\/app\/partials\/a\.html -> src\/frontend\/app\/partials\/b\.html -> src\/frontend\/app\/partials\/a\.html\)/,
  );
});

test('pages without bindings or post forms emit no program', async () => {
  const root = await createWorkspace();
  const page = path.join(root, CLIENTS_SOURCE);
  await fs.writeFile(page, '<head></head><main><p>Static</p></main>', 'utf8');
  await frontendProvider.build({
    workspaceRoot: root,
    env: { WEBSTIR_MODULE_MODE: 'build' },
    incremental: false,
  });
  await assert.rejects(
    fs.access(path.join(root, 'build', 'frontend', 'pages', 'clients', 'index.program.json')),
  );
});

test('a problem in a partial used twice is reported once', async () => {
  const root = await createWorkspace();
  await fs.writeFile(
    path.join(root, 'src', 'frontend', 'app', 'partials', 'row.html'),
    '<span data-text="item.nmae">Name</span>',
    'utf8',
  );
  const program = await compileSource(
    root,
    '<head></head><main><p data-each="items as item" data-include="row"></p><p data-each="items as item" data-include="row"></p></main>',
  );
  const schema = z.object({ items: z.array(z.object({ name: z.string() })) });
  const issues = validateRenderProgram(program, schema, 'fixture');
  assert.equal(issues.length, 2);
  assert.equal(new RenderTemplateError(issues).issues.length, 1);
});
