import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  RenderProgramError,
  executeRenderProgram,
  programUsesCsrf,
  readRenderProgram,
} from '../dist/runtime/render.js';

const loc = { file: 'src/frontend/pages/clients/index.html', line: 7 };

function root(source) {
  return { source, scope: -1, keys: source.split('.') };
}

function scoped(source, scope) {
  return { source, scope, keys: source.split('.').slice(1) };
}

function program(nodes) {
  return { version: 1, page: 'clients', source: loc.file, bindings: 1, nodes };
}

test('text escapes values and renders nothing for null', () => {
  const html = executeRenderProgram(
    program([
      '<p>',
      { op: 'text', path: root('name'), loc },
      '</p><p>',
      { op: 'text', path: root('missing'), loc },
      '</p>',
    ]),
    { name: '<b>"Acme" & Co</b>', missing: null },
  );
  assert.equal(html, '<p>&lt;b&gt;"Acme" &amp; Co&lt;/b&gt;</p><p></p>');
});

test('attributes follow boolean, null and string rules', () => {
  const nodes = [
    '<input',
    { op: 'attr', name: 'value', url: false, path: root('value'), loc },
    { op: 'attr', name: 'required', url: false, path: root('required'), loc },
    { op: 'attr', name: 'disabled', url: false, path: root('disabled'), loc },
    { op: 'attr', name: 'aria-current', url: false, path: root('current'), loc },
    '>',
  ];
  const html = executeRenderProgram(program(nodes), {
    value: `it's "quoted" <x>`,
    required: true,
    disabled: false,
    current: null,
  });
  assert.equal(html, '<input value="it&#39;s &quot;quoted&quot; &lt;x&gt;" required>');
});

test('url attributes block unsafe schemes and keep safe ones', () => {
  const render = (href) =>
    executeRenderProgram(
      program(['<a', { op: 'attr', name: 'href', url: true, path: root('href'), loc }, '>']),
      { href },
    );
  assert.equal(render('javascript:alert(1)'), '<a href="about:invalid">');
  assert.equal(render(' JaVa\tScript:alert(1)'), '<a href="about:invalid">');
  assert.equal(render('data:text/html,hi'), '<a href="about:invalid">');
  assert.equal(
    render('https://example.com/?a=1&b=2'),
    '<a href="https://example.com/?a=1&amp;b=2">',
  );
  assert.equal(render('/clients/acme/'), '<a href="/clients/acme/">');
  assert.equal(render('mailto:hi@example.com'), '<a href="mailto:hi@example.com">');
});

test('if follows the falsy rules and negation', () => {
  const nodes = [
    { op: 'if', negate: false, path: root('value'), loc, body: ['yes'] },
    { op: 'if', negate: true, path: root('value'), loc, body: ['no'] },
  ];
  const render = (value) => executeRenderProgram(program(nodes), { value });
  for (const falsy of [null, undefined, false, '', 0, []]) {
    assert.equal(render(falsy), 'no', `${JSON.stringify(falsy)} is falsy`);
  }
  for (const truthy of [true, 'x', 1, [1], {}]) {
    assert.equal(render(truthy), 'yes', `${JSON.stringify(truthy)} is truthy`);
  }
});

test('each repeats, nests, iterates scalars and shadows outer names', () => {
  const nodes = [
    {
      op: 'each',
      as: 'row',
      path: root('rows'),
      loc,
      body: [
        '<tr>',
        {
          op: 'each',
          as: 'cell',
          path: scoped('row', 0),
          loc,
          body: [
            '<td>',
            { op: 'text', path: scoped('cell', 1), loc },
            { op: 'text', path: root('suffix'), loc },
            '</td>',
          ],
        },
        '</tr>',
      ],
    },
    { op: 'each', as: 'none', path: root('missing'), loc, body: ['never'] },
  ];
  const html = executeRenderProgram(program(nodes), {
    rows: [['a', 'b'], ['c']],
    suffix: '!',
  });
  assert.equal(html, '<tr><td>a!</td><td>b!</td></tr><tr><td>c!</td></tr>');
});

test('paths only read own properties', () => {
  const html = executeRenderProgram(
    program([
      { op: 'text', path: root('item.constructor'), loc },
      { op: 'text', path: root('item.toString'), loc },
    ]),
    { item: {} },
  );
  assert.equal(html, '');
});

test('csrf inserts the token and requires one', () => {
  const csrfProgram = program(['<form method="post">', { op: 'csrf' }, '</form>']);
  assert.equal(programUsesCsrf(csrfProgram), true);
  assert.equal(
    executeRenderProgram(csrfProgram, {}, { csrfToken: 'tok"en' }),
    '<form method="post"><input type="hidden" name="_csrf" value="tok&quot;en"></form>',
  );
  assert.throws(() => executeRenderProgram(csrfProgram, {}), /needs a CSRF token/);

  const nested = program([
    { op: 'if', negate: false, path: root('x'), loc, body: [{ op: 'csrf' }] },
  ]);
  assert.equal(programUsesCsrf(nested), true);
  assert.equal(programUsesCsrf(program(['<p></p>'])), false);
});

test('wrong runtime shapes fail with the source location', () => {
  assert.throws(
    () =>
      executeRenderProgram(program([{ op: 'text', path: root('value'), loc }]), {
        value: { a: 1 },
      }),
    (error) =>
      error instanceof RenderProgramError &&
      error.message ===
        'src/frontend/pages/clients/index.html:7: data-text="value" needs a string or number, got an object',
  );
  assert.throws(
    () =>
      executeRenderProgram(program([{ op: 'each', as: 'x', path: root('value'), loc, body: [] }]), {
        value: 'nope',
      }),
    /index\.html:7: data-each="value as x" needs an array, got a string/,
  );
});

test('readRenderProgram rejects other versions', () => {
  assert.equal(readRenderProgram(program([]), 'p.json').page, 'clients');
  assert.throws(
    () => readRenderProgram({ version: 2, nodes: [] }, 'p.json'),
    /not a version 1 program/,
  );
  assert.throws(() => readRenderProgram(null, 'p.json'), /not a version 1 program/);
});
