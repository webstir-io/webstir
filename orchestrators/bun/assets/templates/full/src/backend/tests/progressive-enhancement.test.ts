import { assert, test } from '@webstir-io/webstir-testing';

test('progressive enhancement demo page renders a form shell', async () => {
  const ctx = requireBackendTestContext();
  const response = await ctx.request('/demo/progressive-enhancement');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.isTrue(html.includes('<title>Progressive Enhancement Demo</title>'));
  assert.isTrue(html.includes('id="greeting-form"'));
  assert.isTrue(html.includes('data-webstir-fragment-target="greeting-preview"'));
  assert.isTrue(html.includes('data-webstir-fragment-target="session-panel"'));
  assert.isTrue(
    html.includes('type="module" src="/src/frontend/app/app.ts"')
    || html.includes('type="module" src="/app/')
    || html.includes('type="module" src="/pages/home/index.js"')
  );
  assert.isTrue(
    html.includes('rel="stylesheet" href="/src/frontend/app/app.css"')
    || html.includes('rel="stylesheet" href="/app/')
  );
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
  assert.isTrue(html.includes('id="greeting-form"'));
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
  assert.isTrue(html.includes('id="greeting-update-focus"'));
});

test('native session sign-in redirects and sets a session cookie', async () => {
  const ctx = requireBackendTestContext();
  const response = await ctx.request('/demo/progressive-enhancement/session/sign-in', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'sessionName=Casey+Proxy',
    redirect: 'manual'
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/demo/progressive-enhancement?session=signed-in');
  assert.isTrue(String(response.headers.get('set-cookie')).includes('webstir_demo_session=Casey%20Proxy'));
});

test('enhanced session sign-in returns a fragment and persists on the next document request', async () => {
  const ctx = requireBackendTestContext();
  const response = await ctx.request('/demo/progressive-enhancement/session/sign-in', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: 'sessionName=Casey+Proxy'
  });

  const html = await response.text();
  const cookie = requireCookie(response.headers.get('set-cookie'));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-webstir-fragment-target'), 'session-panel');
  assert.equal(response.headers.get('x-webstir-fragment-selector'), '#session-panel');
  assert.equal(response.headers.get('x-webstir-fragment-mode'), 'replace');
  assert.isTrue(html.includes('Signed in as <strong>Casey Proxy</strong>'));
  assert.isTrue(html.includes('id="demo-sign-out"'));

  const documentResponse = await ctx.request('/demo/progressive-enhancement', {
    headers: {
      cookie
    }
  });
  const documentHtml = await documentResponse.text();

  assert.equal(documentResponse.status, 200);
  assert.isTrue(documentHtml.includes('data-session-user="Casey Proxy"'));
  assert.isTrue(documentHtml.includes('Reload the page to confirm the session persists.'));
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

function requireCookie(value: string | null): string {
  if (!value) {
    throw new Error('Expected a session cookie header.');
  }

  return value.split(';', 1)[0] ?? value;
}
