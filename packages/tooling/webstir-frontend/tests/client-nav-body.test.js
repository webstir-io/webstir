import { expect, test } from 'bun:test';

import { readDeclaredBody, syncBodyAttributes } from '../dist/features/body-attributes.js';

function element(attributes) {
  const map = new Map(Object.entries(attributes));
  return {
    get attributes() {
      return Array.from(map, ([name, value]) => ({ name, value }));
    },
    getAttribute: (name) => (map.has(name) ? map.get(name) : null),
    hasAttribute: (name) => map.has(name),
    removeAttribute: (name) => map.delete(name),
    setAttribute: (name, value) => map.set(name, value),
    snapshot: () => Object.fromEntries(map),
  };
}

// [label, the outgoing page's HTML body, what scripts changed since, the incoming page's HTML
// body, the result]. A null in what scripts changed means a script removed that attribute.
test.each([
  ['a class changes', { class: 'home' }, {}, { class: 'contact' }, { class: 'contact' }],
  ['a plain page clears them', { class: 'home', 'data-home': '' }, {}, {}, {}],
  [
    'a plain page gains them',
    {},
    {},
    { class: 'docs', 'data-section': 'company' },
    { class: 'docs', 'data-section': 'company' },
  ],
  [
    'one kept, one dropped, one added',
    { class: 'a', id: 'x', 'data-old': '1' },
    {},
    { class: 'b', id: 'y', 'data-new': '2' },
    { class: 'b', id: 'y', 'data-new': '2' },
  ],
  [
    "scripts' classes and attributes stay",
    { class: 'home' },
    { class: 'home menu-open', 'data-shell-mounted': '1' },
    { class: 'contact' },
    { class: 'menu-open contact', 'data-shell-mounted': '1' },
  ],
  [
    'a script-added class the incoming page also declares appears once',
    {},
    { class: 'menu-open' },
    { class: 'menu-open wide' },
    { class: 'menu-open wide' },
  ],
  [
    'a value both pages declare keeps what a script set',
    { 'data-theme': 'light' },
    { 'data-theme': 'dark' },
    { 'data-theme': 'light' },
    { 'data-theme': 'dark' },
  ],
  [
    'a value the pages declare differently takes the incoming one',
    { 'data-theme': 'light' },
    { 'data-theme': 'dark' },
    { 'data-theme': 'contrast' },
    { 'data-theme': 'contrast' },
  ],
  [
    'a class both pages declare keeps a script swap',
    { class: 'shell theme-light' },
    { class: 'shell theme-dark' },
    { class: 'shell theme-light page' },
    { class: 'shell theme-dark page' },
  ],
  [
    'a class a script removed stays removed',
    { class: 'shell sidebar-open' },
    { class: 'shell' },
    { class: 'shell sidebar-open' },
    { class: 'shell' },
  ],
  [
    'a refresh of the same page changes nothing',
    { class: 'home', 'data-x': '1' },
    { class: 'menu-open', 'data-x': '2', 'data-y': '3' },
    { class: 'home', 'data-x': '1' },
    { class: 'menu-open', 'data-x': '2', 'data-y': '3' },
  ],
])('syncBodyAttributes: %s', (_label, outgoingHtml, runtime, incoming, expected) => {
  const body = element(outgoingHtml);
  const declared = readDeclaredBody(body);
  for (const [name, value] of Object.entries(runtime)) {
    if (value === null) body.removeAttribute(name);
    else body.setAttribute(name, value);
  }
  syncBodyAttributes(body, element(incoming), declared);
  expect(body.snapshot()).toEqual(expected);
});

test('what a page declared is what the next navigation takes away', () => {
  const body = element({ class: 'home' });
  let declared = readDeclaredBody(body);
  declared = syncBodyAttributes(body, element({ class: 'second', 'data-second': '' }), declared);
  body.setAttribute('data-runtime', '1');
  syncBodyAttributes(body, element({ class: 'home' }), declared);
  expect(body.snapshot()).toEqual({ class: 'home', 'data-runtime': '1' });
});
