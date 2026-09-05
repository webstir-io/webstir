import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from 'cheerio';

import { injectResourceHints } from '../dist/html/resourceHints.js';

function prefetchHrefs(document) {
  return document('link[rel="prefetch"]')
    .map((_index, element) => document(element).attr('href'))
    .get();
}

test('injectResourceHints prefetches only links that resolve to known pages', () => {
  const document = load(`
    <html>
      <head><title>Home</title></head>
      <body>
        <a href="/about">About</a>
        <a href="/docs/getting-started">Docs</a>
        <a href="/api/account">Account (backend route)</a>
        <a href="/api/account/sign-in">Sign in (backend route)</a>
        <a href="/home">Current page</a>
        <a href="https://example.com/about">External</a>
        <a href="mailto:hello@example.com">Mail</a>
        <a href="#top">Anchor</a>
      </body>
    </html>
  `);

  const result = injectResourceHints(
    document,
    'home',
    '/pages',
    false,
    new Set(['home', 'about', 'docs']),
  );

  assert.equal(result.added, 2);
  assert.deepEqual(result.candidates, ['about', 'docs']);
  assert.equal(result.missingHead, false);
  assert.deepEqual(prefetchHrefs(document), ['/pages/about/index.html', '/pages/docs/index.html']);
});

test('injectResourceHints adds nothing when no link targets a known page', () => {
  const document = load(`
    <html>
      <head><title>Home</title></head>
      <body><a href="/api/account">Account</a></body>
    </html>
  `);

  const result = injectResourceHints(document, 'home', '/pages', false, new Set(['home']));

  assert.equal(result.added, 0);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(prefetchHrefs(document), []);
});

test('injectResourceHints honors the root-index page layout for known pages', () => {
  const document = load(`
    <html>
      <head><title>Home</title></head>
      <body><a href="/about">About</a><a href="/api/status">Status</a></body>
    </html>
  `);

  const result = injectResourceHints(document, 'home', '', true, new Set(['home', 'about']));

  assert.equal(result.added, 1);
  assert.deepEqual(prefetchHrefs(document), ['/about/index.html']);
});
