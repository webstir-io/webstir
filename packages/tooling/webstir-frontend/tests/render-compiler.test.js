import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  RENDER_PROGRAM_VERSION,
  prepareViewData,
  schemaDeclaresField,
} from '@webstir-io/module-contract';

import { executeRenderProgram } from '@webstir-io/module-contract/render';

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

async function writeBackendModule(root, dataSource, shellSource) {
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
      ...(shellSource ? [`  shell: ${shellSource},`] : []),
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

  assert.equal(program.version, RENDER_PROGRAM_VERSION);
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
  assert.deepEqual(validateRenderProgram(program, clientsData, 'view clientsPage'), []);

  await writeBackendModule(root, CLIENTS_SCHEMA_SOURCE);
  await validateRenderPrograms({
    workspaceRoot: root,
    pagesRoot: path.join(root, 'build', 'frontend', 'pages'),
  });
});

// A module's shell is checked at build: both halves, and no view data that it would replace.
for (const [name, shellSource, dataSource, error] of [
  [
    'a shell and its loader',
    '{ data: z.object({}), load: () => ({}) }',
    CLIENTS_SCHEMA_SOURCE,
    null,
  ],
  [
    'a shell beside a view schema open to any key',
    '{ data: z.object({}), load: () => ({}) }',
    `${CLIENTS_SCHEMA_SOURCE}.passthrough()`,
    null,
  ],
  [
    'a shell beside a transformed view schema',
    '{ data: z.object({}), load: () => ({}) }',
    `${CLIENTS_SCHEMA_SOURCE}.transform((value) => value)`,
    null,
  ],
  [
    'a shell without a loader',
    '{ data: z.object({}) }',
    CLIENTS_SCHEMA_SOURCE,
    /exports a `shell` without both a zod `data` schema and a `load` function/,
  ],
  [
    'a view with its own shell data',
    '{ data: z.object({}), load: () => ({}) }',
    CLIENTS_SCHEMA_SOURCE.replace('z.object({\n', 'z.object({\n  shell: z.string(),\n'),
    /view clientsPage has its own `shell` data, which the module's shell replaces/,
  ],
]) {
  test(`the build accepts ${name}${error ? ' only with an error' : ''}`, async () => {
    const root = await createWorkspace();
    await buildWorkspace(root);
    await writeBackendModule(root, dataSource, shellSource);
    const validating = validateRenderPrograms({
      workspaceRoot: root,
      pagesRoot: path.join(root, 'build', 'frontend', 'pages'),
    });
    if (error) await assert.rejects(validating, error);
    else await validating;
  });
}

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

  const issues = validateRenderProgram(program, clientsData, 'view clientsPage');
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
    /src\/frontend\/app\/partials\/sidebar\.html:9: page 'clients' has bindings, but nothing renders it/,
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
  const messages = validateRenderProgram(program, schema, 'view fixture').map(
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
  const messages = validateRenderProgram(program, schema, 'view fixture').map(
    (issue) => issue.message,
  );
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

test('url-bearing attributes are marked for scheme checks', () => {
  const program = compileRenderProgram(
    [
      '<main>',
      '<object data-attr-data="asset"></object>',
      '<img data-attr-srcset="images" data-attr-alt="label" />',
      '<div data-attr-data-id="id"></div>',
      '</main>',
    ].join('\n'),
    { page: 'fixture', source: 'fixture.html' },
  );
  const urls = Object.fromEntries(
    collectOps(program.nodes)
      .filter((op) => op.op === 'attr')
      .map((op) => [op.name, op.url]),
  );
  assert.deepEqual(urls, { data: true, srcset: true, alt: false, 'data-id': false });
});

test('schemaDeclaresField looks through wrappers to the object', () => {
  const plain = z.object({ title: z.string() }).strict();
  const withFlash = z.object({ title: z.string(), flash: z.array(z.unknown()) }).strict();
  assert.equal(schemaDeclaresField(plain, 'flash'), false);
  assert.equal(schemaDeclaresField(withFlash, 'flash'), true);
  assert.equal(schemaDeclaresField(plain.optional(), 'flash'), false);
  assert.equal(schemaDeclaresField(withFlash.optional(), 'flash'), true);
  assert.equal(
    schemaDeclaresField(
      plain.refine(() => true),
      'flash',
    ),
    false,
  );
  assert.equal(
    schemaDeclaresField(
      withFlash.refine(() => true),
      'flash',
    ),
    true,
  );
  assert.equal(
    schemaDeclaresField(
      withFlash.transform((value) => value),
      'flash',
    ),
    true,
  );
  assert.equal(schemaDeclaresField(z.union([plain, withFlash]), 'flash'), true);
  assert.equal(schemaDeclaresField(z.any(), 'flash'), false);
});

test('prepareViewData merges session flash first and fits unions and strict schemas', () => {
  const note = { level: 'success', message: 'Saved.' };
  const own = { level: 'info', message: 'From the loader.' };
  const flashSchema = z.array(z.object({ level: z.string(), message: z.string() }));
  const withFlash = z.object({ title: z.string(), flash: flashSchema }).strict();
  const strict = z.object({ title: z.string() }).strict();

  assert.deepEqual(prepareViewData(withFlash, { title: 'A', flash: [] }, [note]), {
    ok: true,
    data: { title: 'A', flash: [note] },
  });
  assert.deepEqual(prepareViewData(withFlash, { title: 'A', flash: [own] }, [note]).data.flash, [
    note,
    own,
  ]);
  assert.deepEqual(prepareViewData(strict, { title: 'A' }, [note]), {
    ok: true,
    data: { title: 'A', flash: [note] },
  });
  assert.equal(
    prepareViewData(
      strict.refine(() => true),
      { title: 'A' },
      [note],
    ).ok,
    true,
  );

  const union = z.union([strict, z.object({ kind: z.literal('x'), flash: flashSchema }).strict()]);
  assert.equal(
    prepareViewData(union, { title: 'A' }, [note]).ok,
    true,
    'a strict branch without flash still matches',
  );
  assert.equal(prepareViewData(union, { kind: 'x' }, [note]).ok, true);

  const failed = prepareViewData(withFlash, { title: 42 }, []);
  assert.equal(failed.ok, false);
  assert.match(failed.error, /title: Expected string, received number/);
});

test('what makes a form post must be written, not bound', () => {
  const issues = (html) => {
    try {
      compileRenderProgram(`<main>${html}</main>`, { page: 'fixture', source: 'fixture.html' });
      return [];
    } catch (error) {
      return error.issues.map((issue) => issue.message);
    }
  };
  assert.deepEqual(issues('<form data-attr-method="method"></form>'), [
    'data-attr-method="method": form method must be written in the HTML',
  ]);
  assert.deepEqual(issues('<form><button data-attr-formmethod="method">Go</button></form>'), [
    'data-attr-formmethod="method": formmethod must be written in the HTML',
  ]);
  assert.deepEqual(issues('<button data-attr-form="target">Go</button>'), [
    'data-attr-form="target": the form a submit control posts must be written in the HTML',
  ]);
  assert.deepEqual(issues('<input type="text" data-attr-form="target" />'), []);
});

test('every way a form can post gets a CSRF field, and only that form', () => {
  const csrfForms = (html) => {
    const program = compileRenderProgram(`<main>${html}</main>`, {
      page: 'fixture',
      source: 'fixture.html',
    });
    const forms = [];
    const walk = (nodes, current) => {
      for (const node of nodes) {
        if (typeof node === 'string') {
          const opened = [...node.matchAll(/<form[^>]*id="([^"]+)"/g)].at(-1);
          if (opened) current = opened[1];
        } else if (node.op === 'csrf') {
          forms.push(current);
        } else if (node.body) {
          walk(node.body, current);
        }
      }
    };
    walk(program.nodes, undefined);
    return forms;
  };
  const cases = [
    ['<form id="a" method="post"></form>', ['a']],
    ['<form id="a"><button formmethod="post">Save</button></form>', ['a']],
    ['<form id="a"><input type="submit" formmethod="POST" /></form>', ['a']],
    ['<form id="a"></form><button form="a" formmethod="post">Save</button>', ['a']],
    [
      '<form id="a"><button form="b" formmethod="post">Save</button></form><form id="b"></form>',
      ['b'],
    ],
    ['<form id="a"><button>Find</button></form>', []],
    ['<form id="a"><button formmethod="get">Find</button></form>', []],
  ];
  for (const [html, expected] of cases) {
    assert.deepEqual(csrfForms(html), expected, html);
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
  const issues = validateRenderProgram(program, schema, 'view fixture');
  assert.equal(issues.length, 2);
  assert.equal(new RenderTemplateError(issues).issues.length, 1);
});

test('the shell binds on every view page, checked against its own schema', async () => {
  const root = await createWorkspace();
  const program = await compileSource(
    root,
    [
      '<head><title data-text="title">T</title></head>',
      '<main>',
      '<p data-text="shell.account.email"></p>',
      '<p data-text="shell.acount"></p>',
      '</main>',
    ].join('\n'),
  );
  const page = z.object({ title: z.string() });
  const shell = z.object({ account: z.object({ email: z.string() }).nullable() });
  const messages = validateRenderProgram(program, page, 'view fixture', shell).map(
    (issue) => `${issue.loc.line}: ${issue.message.replace(' (view fixture)', '')}`,
  );
  assert.deepEqual(messages, [
    '4: data-text="shell.acount": `shell` has no `acount`; it has `account`',
  ]);
  // Without a shell, `shell` is a binding like any other, and the page data lacks it.
  assert.match(
    validateRenderProgram(program, page, 'view fixture')[0].message,
    /the view data has no `shell`/,
  );
});

async function writePartial(root, name, html) {
  const file = path.join(root, 'src', 'frontend', 'app', 'partials', `${name}.html`);
  await fs.writeFile(file, html, 'utf8');
}

const main = (...lines) => ['<head></head>', '<main>', ...lines, '</main>'].join('\n');
const pathsOf = (program) =>
  collectOps(program.nodes).map((op) => [op.op, op.path.scope, op.path.keys.join('.')]);
const staticOf = (program) => program.nodes.filter((node) => typeof node === 'string').join('');

test('a partial reads the names it is given, so one partial serves different data', async () => {
  const root = await createWorkspace();
  await writePartial(
    root,
    'field',
    [
      '<label data-text="field.label">Label</label>',
      '<input data-attr-value="field.value" />',
      '<p data-if="field.error" data-text="field.error"></p>',
    ].join('\n'),
  );
  const program = await compileSource(
    root,
    main(
      '<div data-include="field" data-with-field="form.email"></div>',
      '<div data-include="field" data-with-field="form.phone"></div>',
      '<ul><li data-each="clients as client" data-include="field" data-with-field="client.contact"></li></ul>',
    ),
  );
  const field = (scope, at) => [
    ['text', scope, `${at}.label`],
    ['attr', scope, `${at}.value`],
    ['if', scope, `${at}.error`],
    ['text', scope, `${at}.error`],
  ];
  assert.deepEqual(pathsOf(program), [
    ...field(-1, 'form.email'),
    ...field(-1, 'form.phone'),
    ['each', -1, 'clients'],
    ...field(0, 'contact'),
  ]);
  assert.doesNotMatch(JSON.stringify(program), /data-with|data-include/);

  const contact = (label, value, error) => ({ label, value, ...(error ? { error } : {}) });
  const html = executeRenderProgram(
    program,
    {
      form: { email: contact('Email', 'ada@example.com', 'Taken'), phone: contact('Phone', '555') },
      clients: [{ contact: contact('Acme', 'acme@example.com') }],
    },
    { csrfToken: false },
  );
  assert.match(
    html,
    /<div><label>Email<\/label>\n<input value="ada@example.com">\n<p>Taken<\/p><\/div>/,
  );
  assert.match(html, /<div><label>Phone<\/label>\n<input value="555">\n<\/div>/);
  assert.match(html, /<li><label>Acme<\/label>\n<input value="acme@example.com">\n<\/li>/);

  // A path through a given name is checked like any other, and reported where it is written.
  const schema = z.object({
    form: z.object({
      email: z.object({ label: z.string(), value: z.string(), error: z.string().optional() }),
      phone: z.object({ label: z.string(), value: z.string() }),
    }),
    clients: z.array(
      z.object({ contact: z.object({ label: z.string(), value: z.string(), error: z.string() }) }),
    ),
  });
  const issues = validateRenderProgram(program, schema, 'view fields');
  assert.deepEqual(
    issues.map((issue) => [issue.loc.file, issue.loc.line]),
    [
      ['src/frontend/app/partials/field.html', 3],
      ['src/frontend/app/partials/field.html', 3],
    ],
  );
  assert.equal(
    issues[0].message,
    'data-if="field.error": `form.phone` has no `error`; it has `label`, `value` (view fields)',
  );
});

test('the nearest name wins, whether a loop made it or data-with gave it', async () => {
  const root = await createWorkspace();
  const cases = [
    // The element that gives a name can use it, beside its loop's item.
    [
      '<p data-each="rows as row" data-with-cell="row.first" data-text="cell.text"></p>',
      [
        ['each', -1, 'rows'],
        ['text', 0, 'first.text'],
      ],
    ],
    [
      '<ul data-with-list="report.rows"><li data-each="list as row" data-text="row.name"></li></ul>',
      [
        ['each', -1, 'report.rows'],
        ['text', 0, 'name'],
      ],
    ],
    [
      '<div data-with-item="chosen"><p data-each="items as item" data-text="item.name"></p></div>',
      [
        ['each', -1, 'items'],
        ['text', 0, 'name'],
      ],
    ],
    [
      '<p data-each="items as item"><span data-with-item="chosen" data-text="item.name"></span></p>',
      [
        ['each', -1, 'items'],
        ['text', -1, 'chosen.name'],
      ],
    ],
    [
      '<div data-with-a="one"><div data-with-b="a.two"><p data-text="b.three"></p></div></div>',
      [['text', -1, 'one.two.three']],
    ],
    // Names given on one element are read from outside it, so they can swap.
    [
      '<div data-with-a="x" data-with-b="y"><div data-with-a="b" data-with-b="a"><p data-text="a"></p><p data-text="b"></p></div></div>',
      [
        ['text', -1, 'y'],
        ['text', -1, 'x'],
      ],
    ],
    // HTML lowercases attribute names, so that is the name given.
    [
      '<div data-with-clientRow="client"><p data-text="clientrow.name"></p></div>',
      [['text', -1, 'client.name']],
    ],
  ];
  for (const [markup, expected] of cases) {
    assert.deepEqual(pathsOf(await compileSource(root, main(markup))), expected, markup);
  }
});

test('text given in single quotes is written into the page by the build', async () => {
  const root = await createWorkspace();
  await writePartial(
    root,
    'button',
    '<span class="icon" data-if="icon" data-attr-data-icon="icon"></span><span data-text="label">Label</span><em data-if="!hint">no hint</em>',
  );
  const program = await compileSource(
    root,
    main(
      `<a class="button" data-include="button" data-with-label="'Save & <close>'" data-with-icon="'check'" data-with-hint="''" data-attr-href="client.href" data-attr-title="label"></a>`,
      `<a class="button" data-include="button" data-with-label="'Delete'" data-with-icon="''" data-with-hint="'careful'" href="/clients/"></a>`,
      `<p data-with-quote="'it's a &quot;quote&quot;'" data-text="quote"></p>`,
    ),
  );
  assert.deepEqual(pathsOf(program), [['attr', -1, 'client.href']]);
  const html = staticOf(program);
  assert.match(html, /<a class="button" title="Save &amp; <close>"/);
  assert.match(
    html,
    /><span class="icon" data-icon="check"><\/span><span>Save &amp; &lt;close&gt;<\/span><em>no hint<\/em><\/a>/,
  );
  assert.match(html, /<a class="button" href="\/clients\/"><span>Delete<\/span><\/a>/);
  assert.match(html, /<p>it's a "quote"<\/p>/);
  assert.doesNotMatch(html, /data-with|data-text|data-if|data-attr|Label/);
});

test('a page whose bindings the build settled is written as plain HTML, with no program', async () => {
  const root = await createWorkspace();
  await writePartial(root, 'badge', '<strong data-text="label">Label</strong>');
  const page = path.join(root, 'src', 'frontend', 'pages', 'about');
  await fs.mkdir(page, { recursive: true });
  await fs.writeFile(
    path.join(page, 'index.html'),
    main(`<p data-include="badge" data-with-label="'Since 2019'"></p>`).replace(
      '<head></head>',
      '<head><title>About</title></head>',
    ),
    'utf8',
  );
  for (const [mode, out] of [
    ['build', 'build/frontend'],
    ['publish', 'dist/frontend'],
  ]) {
    await frontendProvider.build({
      workspaceRoot: root,
      env: { WEBSTIR_MODULE_MODE: mode },
      incremental: false,
    });
    const dir = path.join(root, out, 'pages', 'about');
    const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /<p><strong>Since 2019<\/strong><\/p>/, mode);
    assert.match(html, /<title>About<\/title>/, mode);
    assert.doesNotMatch(html, /data-with|data-text|data-include|data-webstir-src|Label/, mode);
    await assert.rejects(fs.stat(path.join(dir, 'index.program.json')), undefined, mode);
  }
});

test('a name that cannot be given, or text used as data, fails with file and line', async () => {
  const root = await createWorkspace();
  const cases = [
    ['<p data-with-9x="a"></p>', 'data-with-9x="a": `9x` is not a name to give'],
    ['<p data-with-a-b="a"></p>', 'data-with-a-b="a": `a-b` is not a name to give'],
    ['<p data-with-a="b..c"></p>', 'data-with-a="b..c": `b..c` is not a path'],
    ['<p data-with-a=""></p>', 'data-with-a="": expected a path, or text in single quotes'],
    [`<p data-with-a="'x'" data-text="a.b"></p>`, 'data-text="a.b": `a` is text, so it has no `b`'],
    [
      `<p data-with-a="'x'"><i data-with-b="a.c" data-text="b"></i></p>`,
      `data-with-b="a.c": \`a\` is text, so it has no \`c\``,
    ],
    [
      `<ul data-with-a="'x'"><li data-each="a as item"></li></ul>`,
      'data-each="a as item": `a` is text, and this needs data',
    ],
    [
      `<div data-island="chart" data-with-a="'x'" data-props="a"></div>`,
      'data-props="a": `a` is text, and this needs data',
    ],
    [
      '<a data-attr-data-with-a="b"></a>',
      'data-attr-data-with-a="b": `data-with-a` cannot be bound',
    ],
  ];
  for (const [markup, expected] of cases) {
    await assert.rejects(compileSource(root, main(markup)), (error) => {
      assert.ok(error instanceof RenderTemplateError, markup);
      assert.deepEqual(
        error.issues.map((issue) => [issue.loc.file, issue.loc.line]),
        [[CLIENTS_SOURCE, 3]],
        markup,
      );
      assert.ok(
        error.issues[0].message.startsWith(expected),
        `${markup}\nexpected: ${expected}\nactual:   ${error.issues[0].message}`,
      );
      return true;
    });
  }
});

test('a page that gave names and posts a form is written as what it compiled to, for when no view renders it', async () => {
  const root = await createWorkspace();
  const page = path.join(root, 'src', 'frontend', 'pages', 'contact');
  await fs.mkdir(page, { recursive: true });
  await fs.writeFile(
    path.join(page, 'index.html'),
    main(
      `<h1 data-with-title="'Write to us'" data-text="title">Title</h1>`,
      `<p data-with-note="''" data-if="note">Never shown</p>`,
      '<form method="post" action="/contact/"><button>Send</button></form>',
    ),
    'utf8',
  );
  for (const [mode, out] of [
    ['build', 'build/frontend'],
    ['publish', 'dist/frontend'],
  ]) {
    await frontendProvider.build({
      workspaceRoot: root,
      env: { WEBSTIR_MODULE_MODE: mode },
      incremental: false,
    });
    const dir = path.join(root, out, 'pages', 'contact');
    const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /<h1>Write to us<\/h1>/, mode);
    assert.match(
      html,
      /<form method="post" action="\/contact\/"><button>Send<\/button><\/form>/,
      mode,
    );
    assert.doesNotMatch(html, /data-with|data-text|data-if|Never shown|>Title</, mode);
    // A view that renders the page still has its program, with the form's CSRF field.
    const program = JSON.parse(await fs.readFile(path.join(dir, 'index.program.json'), 'utf8'));
    assert.deepEqual(collectOps(program.nodes), [{ op: 'csrf' }], mode);
    assert.match(
      executeRenderProgram(program, {}, { csrfToken: 'token-1' }),
      /<h1>Write to us<\/h1>[\s\S]*name="_csrf" value="token-1"/,
      mode,
    );
  }
});

test('a loop cannot read a name its own element gives', async () => {
  const root = await createWorkspace();
  for (const markup of [
    '<li data-with-list="clients" data-each="list as client"></li>',
    '<li data-each="list.items as client" data-with-list="report"></li>',
  ]) {
    await assert.rejects(compileSource(root, main(markup)), (error) => {
      assert.ok(error instanceof RenderTemplateError, markup);
      assert.deepEqual(
        error.issues.map((issue) => [issue.loc.file, issue.loc.line]),
        [[CLIENTS_SOURCE, 3]],
        markup,
      );
      assert.match(
        error.issues[0].message,
        /a loop is read before the names its element gives, so `list` is not in its reach; give it on an element outside this one/,
        markup,
      );
      return true;
    });
  }
  // Given outside, or given from the loop's own item, it is in reach.
  assert.deepEqual(
    pathsOf(
      await compileSource(
        root,
        main(
          '<ul data-with-list="clients"><li data-each="list as client" data-with-who="client.contact" data-text="who.name"></li></ul>',
        ),
      ),
    ),
    [
      ['each', -1, 'clients'],
      ['text', 0, 'contact.name'],
    ],
  );
});

test('a value of the wrong kind is named by what was read, as a missing one is', async () => {
  const root = await createWorkspace();
  const program = await compileSource(
    root,
    main(
      '<div data-with-field="form.email">',
      '<p data-text="field"></p>',
      '<a data-attr-href="field"></a>',
      '<i data-each="field as part"></i>',
      '</div>',
      '<ul><li data-each="clients as client" data-with-who="client.contact"><b data-text="who"></b></li></ul>',
      '<p data-text="form"></p>',
    ),
  );
  const schema = z.object({
    form: z.object({ email: z.object({ label: z.string() }) }),
    clients: z.array(z.object({ contact: z.object({ name: z.string() }) })),
  });
  const messages = validateRenderProgram(program, schema, 'view fields').map(
    (issue) => issue.message,
  );
  assert.equal(messages.length, 5);
  assert.match(messages[0], /^data-text="field": `form\.email` /);
  assert.match(messages[1], /^data-attr-href="field": `form\.email` /);
  assert.match(messages[2], /^data-each="field as part": `form\.email` /);
  assert.match(messages[3], /^data-text="who": `client\.contact` /);
  // Written as it is read, it says what it always said.
  assert.match(messages[4], /^data-text="form": `form` /);
});
