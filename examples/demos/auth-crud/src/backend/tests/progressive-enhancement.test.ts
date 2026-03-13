import { assert, test } from '@webstir-io/webstir-testing';

const DEMO_PATH = '/demo/auth-crud';

test('auth and CRUD demo page renders the document shell', async () => {
  const page = await requestDemoPage();

  assert.equal(page.response.status, 200);
  assert.isTrue(Boolean(page.cookie));
  assert.isTrue(page.html.includes('<title>Auth And CRUD Demo</title>'));
  assert.isTrue(page.html.includes('id="auth-sign-in-form"'));
  assert.isTrue(page.html.includes('id="project-create-form"'));
  assert.isTrue(page.html.includes('data-webstir-fragment-target="backoffice-shell"'));
  assert.isTrue(
    page.html.includes('type="module" src="/app/')
    || page.html.includes('type="module" src="/pages/home/index.js"')
  );
});

test('native auth-gated create redirects back with preserved draft values', async () => {
  const page = await requestDemoPage();
  const csrf = extractFormInputValue(page.html, 'project-create-form', '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/projects/create`, page.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: `_csrf=${encodeURIComponent(csrf)}&title=${encodeURIComponent('Needs Auth')}&status=draft&notes=${encodeURIComponent('Keep this draft')}`,
    redirect: 'manual'
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), DEMO_PATH);

  const redirected = await requestDemoPage(page.cookie);
  assert.isTrue(redirected.html.includes('Sign in required to manage projects.'));
  assert.isTrue(redirected.html.includes('value="Needs Auth"'));
  assert.isTrue(redirected.html.includes('Keep this draft'));
});

test('native sign-in redirects back and seeds the protected workspace', async () => {
  const page = await requestDemoPage();
  const csrf = extractFormInputValue(page.html, 'auth-sign-in-form', '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/session/sign-in`, page.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: `_csrf=${encodeURIComponent(csrf)}&email=${encodeURIComponent('casey@example.com')}`,
    redirect: 'manual'
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), DEMO_PATH);

  const redirected = await requestDemoPage(page.cookie);
  assert.isTrue(redirected.html.includes('Signed in as <strong>casey@example.com</strong>.'));
  assert.isTrue(redirected.html.includes('Operations cleanup'));
  assert.isTrue(redirected.html.includes('Launch checklist'));
  assert.isTrue(redirected.html.includes('Signed in as casey@example.com.'));
});

test('native create uses redirect-after-post and flashes the new project', async () => {
  const signedIn = await signInAndLoadPage();
  const csrf = extractFormInputValue(signedIn.html, 'project-create-form', '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/projects/create`, signedIn.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: [
      `_csrf=${encodeURIComponent(csrf)}`,
      `title=${encodeURIComponent('Backoffice Sweep')}`,
      'status=active',
      `notes=${encodeURIComponent('Confirm redirect-after-post in the canonical proof app.')}`
    ].join('&'),
    redirect: 'manual'
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), DEMO_PATH);

  const redirected = await requestDemoPage(signedIn.cookie);
  assert.isTrue(redirected.html.includes('Created project &quot;Backoffice Sweep&quot;.'));
  assert.isTrue(redirected.html.includes('Backoffice Sweep'));
});

test('enhanced create validation failure returns a fragment shell with inline errors', async () => {
  const signedIn = await signInAndLoadPage();
  const csrf = extractFormInputValue(signedIn.html, 'project-create-form', '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/projects/create`, signedIn.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(csrf)}&title=&status=active&notes=${encodeURIComponent('Too blank to save')}`
  });

  const html = await response.text();

  assert.equal(response.status, 422);
  assert.equal(response.headers.get('x-webstir-fragment-target'), 'backoffice-shell');
  assert.equal(response.headers.get('x-webstir-fragment-selector'), '#backoffice-shell');
  assert.equal(response.headers.get('x-webstir-fragment-mode'), 'replace');
  assert.isTrue(html.startsWith('<section id="backoffice-shell"'));
  assert.isTrue(html.includes('Project title is required.'));
  assert.isTrue(html.includes('Too blank to save'));
});

test('enhanced update and delete return fragment shells and persist across reloads', async () => {
  const signedIn = await signInAndLoadPage();
  const projectId = extractFirstProjectId(signedIn.html);
  const updateCsrf = extractFormInputValue(signedIn.html, `project-edit-form-${projectId}`, '_csrf');
  const updateResponse = await requestWithCookie(`${DEMO_PATH}/projects/update`, signedIn.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: [
      `_csrf=${encodeURIComponent(updateCsrf)}`,
      `projectId=${encodeURIComponent(projectId)}`,
      `title=${encodeURIComponent('Operations cleanup updated')}`,
      'status=archived',
      `notes=${encodeURIComponent('Persist this edit across the next document request.')}`
    ].join('&')
  });
  const updateHtml = await updateResponse.text();

  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.headers.get('x-webstir-fragment-target'), 'backoffice-shell');
  assert.isTrue(updateHtml.includes('Operations cleanup updated'));
  assert.isTrue(updateHtml.includes('Updated project &quot;Operations cleanup updated&quot;.'));

  const persisted = await requestDemoPage(signedIn.cookie);
  assert.isTrue(persisted.html.includes('Operations cleanup updated'));

  const deleteCsrf = extractFormInputValue(persisted.html, `project-delete-form-${projectId}`, '_csrf');
  const deleteResponse = await requestWithCookie(`${DEMO_PATH}/projects/delete`, signedIn.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(deleteCsrf)}&projectId=${encodeURIComponent(projectId)}`
  });
  const deleteHtml = await deleteResponse.text();

  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteResponse.headers.get('x-webstir-fragment-target'), 'backoffice-shell');
  assert.equal(deleteHtml.includes(`project-edit-form-${projectId}`), false);

  const afterDelete = await requestDemoPage(signedIn.cookie);
  assert.equal(afterDelete.html.includes(`project-edit-form-${projectId}`), false);
  assert.isTrue(afterDelete.html.includes('Deleted project &quot;Operations cleanup updated&quot;.'));
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

async function requestDemoPage(cookie?: string): Promise<{
  response: Response;
  html: string;
  cookie: string;
}> {
  const response = await requestWithCookie(DEMO_PATH, cookie);
  const html = await response.text();
  return {
    response,
    html,
    cookie: coalesceCookie(response.headers.get('set-cookie'), cookie)
  };
}

async function signInAndLoadPage(): Promise<{
  html: string;
  cookie: string;
}> {
  const initial = await requestDemoPage();
  const csrf = extractFormInputValue(initial.html, 'auth-sign-in-form', '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/session/sign-in`, initial.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: `_csrf=${encodeURIComponent(csrf)}&email=${encodeURIComponent('casey@example.com')}`,
    redirect: 'manual'
  });

  assert.equal(response.status, 303);

  const page = await requestDemoPage(initial.cookie);
  return {
    html: page.html,
    cookie: page.cookie
  };
}

async function requestWithCookie(
  pathOrUrl: string | URL,
  cookie?: string,
  init: RequestInit = {}
): Promise<Response> {
  const ctx = requireBackendTestContext();
  const headers = new Headers(init.headers);
  if (cookie) {
    headers.set('cookie', cookie);
  }
  return await ctx.request(pathOrUrl, {
    ...init,
    headers
  });
}

function extractFormInputValue(html: string, formId: string, name: string): string {
  const formPattern = new RegExp(
    `<form[^>]*id="${escapeRegExp(formId)}"[\\s\\S]*?<input[^>]*name="${escapeRegExp(name)}"[^>]*value="([^"]*)"`,
    'i'
  );
  const match = html.match(formPattern);
  if (!match?.[1]) {
    throw new Error(`Expected input ${name} in form ${formId}.`);
  }
  return decodeHtml(match[1]);
}

function extractFirstProjectId(html: string): string {
  const match = html.match(/data-project-id="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error('Expected at least one project row.');
  }
  return decodeHtml(match[1]);
}

function coalesceCookie(setCookie: string | null, existing: string | undefined): string {
  const cookie = setCookie?.split(';', 1)[0] ?? existing;
  if (!cookie) {
    throw new Error('Expected a session cookie.');
  }
  return cookie;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
