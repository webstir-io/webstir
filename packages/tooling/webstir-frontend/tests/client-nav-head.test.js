import { expect, test } from 'bun:test';

import {
  isPageMetadata,
  resolveHeadMetadataSync,
  resolveMetadataHref,
} from '../dist/features/head-metadata.js';
import { resolveReferrerPolicyNavigation } from '../dist/features/referrer-policy-change.js';

const meta = (attributes) => ({ tag: 'meta', attributes });
const link = (attributes) => ({ tag: 'link', attributes });

test.each([
  ['meta name=description', meta({ name: 'description', content: 'About' }), true],
  ['meta name=robots', meta({ name: 'robots', content: 'noindex' }), true],
  ['meta name=theme-color', meta({ name: 'theme-color', content: '#fff' }), true],
  ['meta name=color-scheme', meta({ name: 'color-scheme', content: 'dark' }), true],
  ['meta name in any case', meta({ name: 'DESCRIPTION', content: 'About' }), true],
  [
    'meta name= referrer , which browsers do not trim',
    meta({ name: ' referrer ', content: 'x' }),
    true,
  ],
  ['meta property=og:url', meta({ property: 'og:url', content: 'https://a.test/' }), true],
  ['link rel=canonical', link({ rel: 'canonical', href: '/about' }), true],
  ['link rel=CANONICAL', link({ rel: 'CANONICAL', href: '/about' }), true],
  ['link rel=alternate hreflang', link({ rel: 'alternate', hreflang: 'de', href: '/de' }), true],
  ['link rel=prev', link({ rel: 'prev', href: '/1' }), true],
  ['link rel=next', link({ rel: 'next', href: '/3' }), true],
  ['meta charset', meta({ charset: 'utf-8' }), false],
  ['meta name=referrer', meta({ name: 'referrer', content: 'no-referrer' }), false],
  ['meta name=ReFeRrEr', meta({ name: 'ReFeRrEr', content: 'origin' }), false],
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
      meta({ name: 'description', content: 'About' }),
      link({ rel: 'canonical', href: '/x' }),
    ],
    expected: { remove: [], add: [4, 5] },
  },
  {
    label: 'metadata the incoming page lacks is removed',
    current: [
      ...shell,
      meta({ property: 'og:title', content: 'A' }),
      meta({ name: 'robots', content: 'noindex' }),
    ],
    next: shell,
    expected: { remove: [4, 5], add: [] },
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
    expected: { remove: [0, 5], add: [0, 5] },
  },
  {
    label: 'referrer metas stay where they are on both sides',
    current: [...shell, meta({ name: 'referrer', content: 'no-referrer' })],
    next: [...shell, meta({ name: 'Referrer', content: 'no-referrer' })],
    expected: { remove: [], add: [] },
  },
])('resolveHeadMetadataSync: $label', ({ current, next, expected }) => {
  expect(resolveHeadMetadataSync({ current, next })).toEqual(expected);
});

const page = (head = '', main = '') =>
  `<!doctype html><html><head><title>t</title>${head}</head><body><main>${main}</main></body></html>`;
const referrerMeta = (content) => `<meta name="referrer" content="${content}">`;

test.each([
  // Neither side sets a policy, or both set the same one: stay client-side.
  ['no policy on either side', null, page(), null, [], false],
  [
    'the same meta on both sides',
    null,
    page(referrerMeta('no-referrer')),
    null,
    ['no-referrer'],
    false,
  ],
  ['the same header on both sides', 'origin', page(), 'origin', [], false],
  [
    'a header on one side and the same meta on the other',
    'no-referrer',
    page(),
    null,
    ['no-referrer'],
    false,
  ],
  [
    'the same policy spelled differently',
    null,
    page(referrerMeta(' NEVER ')),
    null,
    ['no-referrer'],
    false,
  ],
  ['an invalid incoming meta sets nothing', null, page(referrerMeta('bogus')), null, [], false],
  ['an invalid incoming header sets nothing', 'nope', page(), null, [], false],
  ['the last valid header token counts', 'no-referrer, origin, bogus', page(), 'origin', [], false],
  ['a first load is taken to share the incoming header', 'origin', page(), undefined, [], false],
  [
    'a first load with no header matches an incoming page with none',
    null,
    page(),
    undefined,
    [],
    false,
  ],
  [
    'a meta overrides the header on the incoming side',
    'unsafe-url',
    page(referrerMeta('origin')),
    'origin',
    [],
    false,
  ],
  [
    'a meta overrides the header on the current side',
    'origin',
    page(),
    'unsafe-url',
    ['origin'],
    false,
  ],
  [
    'a name that is referrer only after trimming is not a referrer meta',
    null,
    page('<meta name=" referrer " content="no-referrer">'),
    null,
    [],
    false,
  ],
  [
    'a meta whose content mentions referrer is not one',
    null,
    page('<meta name="description" content="our referrer policy">'),
    null,
    [],
    false,
  ],
  [
    'a <metadata> element is not a meta',
    null,
    page('<metadata name="referrer" content="no-referrer"></metadata>'),
    null,
    [],
    false,
  ],
  // Markup that is not an element does not count.
  ['a meta in a comment', null, page(`<!-- ${referrerMeta('no-referrer')} -->`), null, [], false],
  [
    'a meta in a comment closed with --!>',
    null,
    page(`<!-- ${referrerMeta('origin')} --!>`),
    null,
    [],
    false,
  ],
  [
    'a meta in an unterminated comment',
    null,
    `${page()}<!-- ${referrerMeta('origin')}`,
    null,
    [],
    false,
  ],
  [
    'a meta in a script string',
    null,
    page(`<script>const x = '${referrerMeta('origin')}';</script>`),
    null,
    [],
    false,
  ],
  [
    'a meta in a style, a textarea and a title',
    null,
    page(
      `<style>/* ${referrerMeta('origin')} */</style>`,
      `<textarea>${referrerMeta('origin')}</textarea><title>${referrerMeta('origin')}</title>`,
    ),
    null,
    [],
    false,
  ],
  [
    'a meta in an unterminated script',
    null,
    `${page()}<SCRIPT type="module">${referrerMeta('origin')}`,
    null,
    [],
    false,
  ],
  // The incoming page sets a different policy, or drops the current one: load in full.
  [
    'an incoming meta the current page lacks',
    null,
    page(referrerMeta('no-referrer')),
    null,
    [],
    true,
  ],
  ['an incoming header the current page lacks', 'no-referrer', page(), null, [], true],
  ['a current meta the incoming page lacks', null, page(), null, ['no-referrer'], true],
  ['a current header the incoming page lacks', null, page(), 'origin', [], true],
  ['a different meta', null, page(referrerMeta('unsafe-url')), null, ['no-referrer'], true],
  ['a different header', 'unsafe-url', page(), 'origin', [], true],
  ['a meta inside <main>', null, page('', referrerMeta('origin')), null, [], true],
  [
    'a meta in the body after <main>',
    null,
    `${page()}<meta name=referrer content=origin>`,
    null,
    [],
    true,
  ],
  [
    'an unquoted meta in any case',
    null,
    page('<META NAME=REFERRER CONTENT=no-referrer>'),
    null,
    [],
    true,
  ],
  [
    'a single-quoted meta, content first',
    null,
    page(`<meta content='origin' name='referrer'>`),
    null,
    [],
    true,
  ],
  [
    'a meta with a > inside a quoted value',
    null,
    page('<meta data-x="a>b" name="referrer" content="origin">'),
    null,
    [],
    true,
  ],
  [
    'a legacy keyword that differs',
    null,
    page(referrerMeta('default')),
    null,
    ['strict-origin-when-cross-origin'],
    true,
  ],
  [
    'the last valid meta counts',
    null,
    page(referrerMeta('origin') + referrerMeta('no-referrer')),
    null,
    ['origin'],
    true,
  ],
  [
    'a meta after an abruptly closed comment',
    null,
    page(`<!--><!--->${referrerMeta('origin')}`),
    null,
    [],
    true,
  ],
  [
    'a meta after a script whose text opens a comment',
    null,
    page(`<script>"<!--"</script>${referrerMeta('origin')}`),
    null,
    [],
    true,
  ],
  [
    'a meta after a script end tag in another case',
    null,
    page(`<script>x</SCRIPT >${referrerMeta('origin')}`),
    null,
    [],
    true,
  ],
  [
    'a meta after a <scripts> element, which is not raw text',
    null,
    page(`<scripts>${referrerMeta('origin')}</scripts>`),
    null,
    [],
    true,
  ],
  [
    'a meta in <noscript>, which a parser without scripting reads',
    null,
    page(`<noscript>${referrerMeta('origin')}</noscript>`),
    null,
    [],
    true,
  ],
  [
    'the policy the last navigation kept, once its meta is gone',
    null,
    page(),
    'unsafe-url',
    [],
    true,
  ],
  [
    'a kept policy the incoming page shares',
    null,
    page(referrerMeta('unsafe-url')),
    'unsafe-url',
    [],
    false,
  ],
  ['a meta added since over the kept policy', null, page(), null, ['origin'], true],
  // A referrer meta that cannot be read for certain: load in full.
  [
    'a name written with a character reference',
    null,
    page('<meta name="&#114;eferrer" content="origin">'),
    null,
    [],
    true,
  ],
  [
    'a content written with a character reference',
    null,
    page('<meta name="referrer" content="&#111;rigin">'),
    null,
    ['origin'],
    true,
  ],
  [
    'a tag the reading cannot follow',
    null,
    page(`<meta a" name=referrer content=origin>`),
    null,
    [],
    true,
  ],
])('resolveReferrerPolicyNavigation: %s', (_label, header, html, committed, metas, expected) => {
  const result = resolveReferrerPolicyNavigation({
    incoming: { header, html },
    current: { committed, metas },
  });
  expect(result.kind === 'load').toBe(expected);
});

test.each([
  ['none on either side', null, page(), null, [], null],
  [
    'the shared meta policy',
    null,
    page(referrerMeta('never')),
    null,
    ['no-referrer'],
    'no-referrer',
  ],
  ['the shared header policy', 'Origin', page(), undefined, [], 'origin'],
])('resolveReferrerPolicyNavigation keeps %s', (_label, header, html, committed, metas, policy) => {
  expect(
    resolveReferrerPolicyNavigation({ incoming: { header, html }, current: { committed, metas } }),
  ).toEqual({ kind: 'render', policy });
});

test.each([
  [
    'a relative href against the page address',
    'guide',
    'https://a.test/docs/page',
    null,
    'https://a.test/docs/guide',
  ],
  ['a root-relative href', '/guide', 'https://a.test/docs/page', null, 'https://a.test/guide'],
  ['an absolute href', 'https://b.test/x', 'https://a.test/docs/page', null, 'https://b.test/x'],
  [
    'a relative href against an absolute-path base',
    'guide',
    'https://a.test/pages/next',
    '/docs/',
    'https://a.test/docs/guide',
  ],
  [
    'a relative href against a relative base',
    'guide',
    'https://a.test/pages/next',
    'v2/',
    'https://a.test/pages/v2/guide',
  ],
  [
    'a relative href against another origin base',
    'guide',
    'https://a.test/pages/next',
    'https://cdn.test/root/',
    'https://cdn.test/root/guide',
  ],
  [
    'an empty href is the base itself',
    '',
    'https://a.test/pages/next',
    '/docs/',
    'https://a.test/docs/',
  ],
  [
    'an unparseable base falls back to the page address',
    'guide',
    'https://a.test/pages/next',
    'http://[',
    'https://a.test/pages/guide',
  ],
  ['an unparseable href', 'http://[', 'https://a.test/pages/next', null, null],
  [
    'a javascript: base is ignored',
    'guide',
    'https://a.test/pages/next',
    'javascript:alert(1)',
    'https://a.test/pages/guide',
  ],
  [
    'a JavaScript: base is ignored for a fragment',
    '#top',
    'https://a.test/pages/next',
    'JavaScript:void 0',
    'https://a.test/pages/next#top',
  ],
  [
    'a data: base is ignored',
    'guide',
    'https://a.test/pages/next',
    'data:text/html,x',
    'https://a.test/pages/guide',
  ],
  ['an http href is kept', 'http://b.test/x', 'https://a.test/pages/next', null, 'http://b.test/x'],
  ['a javascript: href is refused', 'javascript:alert(1)', 'https://a.test/p', null, null],
  ['a JavaScript: href is refused', 'JavaScript:alert(1)', 'https://a.test/p', null, null],
  [
    'a padded javascript: href is refused',
    '  java\tscript:alert(1) ',
    'https://a.test/p',
    null,
    null,
  ],
  ['a data: href is refused', 'data:text/html,<script>x</script>', 'https://a.test/p', null, null],
  ['a DATA: href is refused', ' DATA:text/plain,x', 'https://a.test/p', null, null],
  ['a vbscript: href is refused', 'vbscript:msgbox(1)', 'https://a.test/p', null, null],
  ['a blob: href is refused', 'blob:https://a.test/uuid', 'https://a.test/p', null, null],
  ['a mailto: href is refused', 'mailto:a@a.test', 'https://a.test/p', null, null],
  ['a file: href is refused', 'file:///etc/passwd', 'https://a.test/p', null, null],
  ['a relative href against a file: page is refused', 'guide', 'file:///p/', null, null],
])('resolveMetadataHref: %s', (_label, href, url, baseHref, expected) => {
  expect(resolveMetadataHref({ href, url, baseHref })).toBe(expected);
});
