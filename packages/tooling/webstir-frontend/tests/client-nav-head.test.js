import { expect, test } from 'bun:test';

import { isPageMetadata, resolveHeadMetadataSync } from '../dist/features/head-metadata.js';

const meta = (attributes) => ({ tag: 'meta', attributes });
const link = (attributes) => ({ tag: 'link', attributes });

test.each([
  ['meta name=referrer', meta({ name: 'referrer', content: 'no-referrer' }), true],
  ['meta name=description', meta({ name: 'description', content: 'About' }), true],
  ['meta name=robots', meta({ name: 'robots', content: 'noindex' }), true],
  ['meta name=theme-color', meta({ name: 'theme-color', content: '#fff' }), true],
  ['meta name=color-scheme', meta({ name: 'color-scheme', content: 'dark' }), true],
  ['meta name in any case', meta({ name: 'ReFeRrEr', content: 'origin' }), true],
  ['meta property=og:url', meta({ property: 'og:url', content: 'https://a.test/' }), true],
  ['link rel=canonical', link({ rel: 'canonical', href: '/about' }), true],
  ['link rel=CANONICAL', link({ rel: 'CANONICAL', href: '/about' }), true],
  ['link rel=alternate hreflang', link({ rel: 'alternate', hreflang: 'de', href: '/de' }), true],
  ['link rel=prev', link({ rel: 'prev', href: '/1' }), true],
  ['link rel=next', link({ rel: 'next', href: '/3' }), true],
  ['meta charset', meta({ charset: 'utf-8' }), false],
  ['meta name=viewport', meta({ name: 'viewport', content: 'width=device-width' }), false],
  ['meta name= Viewport ', meta({ name: ' Viewport ', content: 'width=device-width' }), false],
  [
    'meta http-equiv',
    meta({ 'http-equiv': 'content-security-policy', content: "default-src 'self'" }),
    false,
  ],
  [
    'meta http-equiv with a name',
    meta({ name: 'x', 'http-equiv': 'refresh', content: '0' }),
    false,
  ],
  ['meta with an empty name', meta({ name: ' ', content: 'x' }), false],
  ['meta with no name or property', meta({ content: 'x' }), false],
  ['link rel=stylesheet', link({ rel: 'stylesheet', href: '/app/app.css' }), false],
  [
    'link rel="alternate stylesheet"',
    link({ rel: 'alternate stylesheet', href: '/dark.css' }),
    false,
  ],
  ['link rel=icon', link({ rel: 'icon', href: '/favicon.ico' }), false],
  ['link rel=manifest', link({ rel: 'manifest', href: '/app.webmanifest' }), false],
  ['link rel=modulepreload', link({ rel: 'modulepreload', href: '/pages/home/index.js' }), false],
  ['link with no rel', link({ href: '/about' }), false],
  ['script', { tag: 'script', attributes: { src: '/clientNav.js' } }, false],
])('isPageMetadata: %s -> %p', (_label, element, expected) => {
  expect(isPageMetadata(element)).toBe(expected);
});

const shell = [
  meta({ charset: 'utf-8' }),
  meta({ name: 'viewport', content: 'width=device-width' }),
  link({ rel: 'stylesheet', href: '/app/app.css' }),
  link({ rel: 'icon', href: '/favicon.ico' }),
];

test.each([
  {
    label: 'the incoming page adds metadata the outgoing page lacked',
    current: shell,
    next: [
      ...shell,
      meta({ name: 'referrer', content: 'no-referrer' }),
      link({ rel: 'canonical', href: '/x' }),
    ],
    header: null,
    expected: { remove: [], add: [4, 5], referrerPolicy: 'no-referrer' },
  },
  {
    label: 'metadata the incoming page lacks is removed',
    current: [
      ...shell,
      meta({ name: 'referrer', content: 'no-referrer' }),
      meta({ name: 'robots', content: 'noindex' }),
    ],
    next: shell,
    header: null,
    expected: { remove: [4, 5], add: [], referrerPolicy: 'strict-origin-when-cross-origin' },
  },
  {
    label: 'changed metadata is replaced, in the incoming order',
    current: [
      meta({ name: 'description', content: 'A' }),
      ...shell,
      link({ rel: 'canonical', href: '/a' }),
    ],
    next: [
      link({ rel: 'canonical', href: '/b' }),
      ...shell,
      meta({ name: 'description', content: 'B' }),
    ],
    header: null,
    expected: { remove: [0, 5], add: [0, 5], referrerPolicy: 'strict-origin-when-cross-origin' },
  },
  {
    label: 'the Referrer-Policy header applies when the page has no referrer meta',
    current: [...shell, meta({ name: 'referrer', content: 'no-referrer' })],
    next: shell,
    header: 'origin',
    expected: { remove: [4], add: [], referrerPolicy: 'origin' },
  },
  {
    label: 'a referrer meta overrides the header',
    current: shell,
    next: [...shell, meta({ name: 'referrer', content: 'same-origin' })],
    header: 'unsafe-url',
    expected: { remove: [], add: [4], referrerPolicy: 'same-origin' },
  },
  {
    label: 'the last valid token of the header wins',
    current: shell,
    next: shell,
    header: 'no-referrer, bogus, Strict-Origin ,',
    expected: { remove: [], add: [], referrerPolicy: 'strict-origin' },
  },
  {
    label: 'the last valid referrer meta wins and invalid ones are ignored',
    current: shell,
    next: [
      meta({ name: 'referrer', content: 'origin' }),
      meta({ name: 'Referrer', content: ' NEVER ' }),
      meta({ name: 'referrer', content: 'bogus' }),
      meta({ name: 'referrer', content: '' }),
    ],
    header: 'unsafe-url',
    expected: { remove: [], add: [0, 1, 2, 3], referrerPolicy: 'no-referrer' },
  },
  {
    label: 'legacy referrer keywords map to their policies',
    current: shell,
    next: [meta({ name: 'referrer', content: 'origin-when-crossorigin' })],
    header: null,
    expected: { remove: [], add: [0], referrerPolicy: 'origin-when-cross-origin' },
  },
  {
    label: 'an invalid header and meta leave the browser default',
    current: shell,
    next: [meta({ name: 'referrer', content: 'none' })],
    header: 'nope',
    expected: { remove: [], add: [0], referrerPolicy: 'strict-origin-when-cross-origin' },
  },
  {
    label: 'a referrer meta outside page metadata is not read',
    current: shell,
    next: [meta({ name: 'referrer', 'http-equiv': 'x', content: 'no-referrer' })],
    header: null,
    expected: { remove: [], add: [], referrerPolicy: 'strict-origin-when-cross-origin' },
  },
])('resolveHeadMetadataSync: $label', ({ current, next, header, expected }) => {
  expect(resolveHeadMetadataSync({ current, next, referrerPolicyHeader: header })).toEqual(
    expected,
  );
});
