import { assert, test } from '@webstir-io/webstir-testing';

test('progressive enhancement demo page renders a form shell', async () => {
  const ctx = requireBackendTestContext();
  const response = await ctx.request('/demo/progressive-enhancement');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.isTrue(html.includes('<title>Progressive Enhancement Demo</title>'));
  assert.isTrue(html.includes('<form method="post">'));
  assert.isTrue(html.includes('data-webstir-fragment-target="greeting-preview"'));
  assert.isTrue(html.includes('type="module" src="/app/'));
});

test('native form submissions redirect back to the document route', async () => {
  const ctx = requireBackendTestContext();
  const response = await ctx.request('/demo/progressive-enhancement', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'name=Native+Flow',
    redirect: 'manual'
  });

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    '/demo/progressive-enhancement?source=redirect&name=Native%20Flow'
  );
  assert.equal(response.headers.get('x-webstir-fragment-target'), null);
  assert.equal(response.headers.get('content-type'), null);
});

test('redirected document route preserves the no-javascript form flow', async () => {
  const ctx = requireBackendTestContext();
  const response = await ctx.request('/demo/progressive-enhancement?source=redirect&name=Native%20Flow');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.isTrue(html.includes('Last submit used the no-JavaScript redirect path.'));
  assert.isTrue(html.includes('Hello, Native Flow'));
  assert.isTrue(html.includes('The browser completed a full-page redirect after the form POST.'));
  assert.isTrue(html.includes('<form method="post">'));
});

test('enhanced form submissions return fragment metadata and html', async () => {
  const ctx = requireBackendTestContext();
  const response = await ctx.request('/demo/progressive-enhancement', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: 'name=Fragment+Flow'
  });

  const html = await response.text();

  assert.equal(response.status, 200);
  assert.isTrue(String(response.headers.get('content-type')).includes('text/html'));
  assert.equal(response.headers.get('x-webstir-fragment-target'), 'greeting-preview');
  assert.equal(response.headers.get('x-webstir-fragment-selector'), '#greeting-preview');
  assert.equal(response.headers.get('x-webstir-fragment-mode'), 'replace');
  assert.isTrue(html.startsWith('<section id="greeting-preview"'));
  assert.equal(html.includes('<!DOCTYPE html>'), false);
  assert.isTrue(html.includes('Hello, Fragment Flow'));
  assert.isTrue(html.includes('replace just this region'));
});

interface BackendTestContext {
  request(pathOrUrl?: string | URL, init?: RequestInit): Promise<Response>;
}

function requireBackendTestContext(): BackendTestContext {
  const store = globalThis as Record<string | symbol, unknown>;
  const context = store[Symbol.for('webstir.backendTestContext')] as BackendTestContext | undefined;
  if (!context) {
    throw new Error('Backend test context not available.');
  }
  return context;
}
