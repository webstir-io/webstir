import { assert } from '@webstir-io/webstir-testing';
import {
  backendTest,
  type BackendTestContext
} from '@webstir-io/webstir-backend/testing';

backendTest('progressive enhancement demo page renders a form shell', async (ctx: BackendTestContext) => {
  const response = await ctx.request('/demo/progressive-enhancement');
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.isTrue(html.includes('<title>Progressive Enhancement Demo</title>'));
  assert.isTrue(html.includes('<form method="post">'));
  assert.isTrue(html.includes('data-webstir-fragment-target="greeting-preview"'));
  assert.isTrue(html.includes('type="module" src="/app/'));
});

backendTest('native form submissions redirect back to the document route', async (ctx: BackendTestContext) => {
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
});

backendTest('enhanced form submissions return fragment metadata and html', async (ctx: BackendTestContext) => {
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
  assert.equal(response.headers.get('x-webstir-fragment-target'), 'greeting-preview');
  assert.equal(response.headers.get('x-webstir-fragment-selector'), '#greeting-preview');
  assert.equal(response.headers.get('x-webstir-fragment-mode'), 'replace');
  assert.isTrue(html.includes('Hello, Fragment Flow'));
  assert.isTrue(html.includes('replace just this region'));
});
