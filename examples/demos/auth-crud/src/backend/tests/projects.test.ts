import { readFileSync } from 'node:fs';
import path from 'node:path';

import { assert, test } from '@webstir-io/webstir-testing';

test('a signed-out visitor to projects is sent to sign in', async () => {
  const response = await request('/projects/', undefined, { redirect: 'manual' });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/sign-in/?returnTo=%2Fprojects%2F');
});

test('a signed-in user creates a project, and a queued job emails them about it', async () => {
  const email = `tester-${Date.now()}@example.com`;
  const cookie = await signIn(email);

  const page = await document('/projects/', cookie);
  assert.isTrue(page.html.includes(`Signed in as <strong>${email}</strong>.`));

  const invalid = await post('/projects/', page.cookie, {
    title: '',
    status: 'draft',
    notes: 'x',
    _csrf: csrf(page.html),
  });
  assert.equal(invalid.status, 422);
  assert.isTrue((await invalid.text()).includes('Project title is required.'));

  const created = await post('/projects/', page.cookie, {
    title: 'Launch plan',
    status: 'active',
    notes: '',
    _csrf: csrf(page.html),
  });
  assert.equal(created.status, 303);
  const after = await document('/projects/', page.cookie);
  assert.isTrue(after.html.includes('Created project "Launch plan".'));
  assert.isTrue(after.html.includes('<h4>Launch plan</h4>'));

  const deadline = Date.now() + 10_000;
  while (
    !emails().some((message) => message.to === email && message.subject === 'Project created: Launch plan')
  ) {
    if (Date.now() > deadline) throw new Error('Expected the project-created email.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

async function signIn(email: string): Promise<string> {
  const asking = await document('/sign-in/');
  const requested = await post('/sign-in/', asking.cookie, {
    intent: 'request',
    email,
    _csrf: csrf(asking.html),
  });
  assert.equal(requested.status, 303);
  const checking = await document('/sign-in/', cookieFrom(requested, asking.cookie));
  const code = /code is (\d{6})/.exec(
    emails()
      .filter((message) => message.to === email)
      .at(-1)?.text ?? '',
  )?.[1];
  const signedIn = await post('/sign-in/', checking.cookie, {
    intent: 'code',
    code: code ?? '',
    _csrf: csrf(checking.html),
  });
  assert.equal(signedIn.status, 303);
  return cookieFrom(signedIn, checking.cookie);
}

/** The emails the dev transport kept in .webstir/email.log. */
function emails(): { to: string; subject: string; text: string }[] {
  const root = process.env.WEBSTIR_WORKSPACE_ROOT ?? process.cwd();
  try {
    return readFileSync(path.join(root, '.webstir', 'email.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function document(pathname: string, cookie?: string): Promise<{ html: string; cookie: string }> {
  const response = await request(pathname, cookie);
  return { html: await response.text(), cookie: cookieFrom(response, cookie) };
}

function post(pathname: string, cookie: string, form: Record<string, string>): Promise<Response> {
  return request(pathname, cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    redirect: 'manual',
  });
}

async function request(pathname: string, cookie?: string, init: RequestInit = {}): Promise<Response> {
  const context = (globalThis as Record<symbol, unknown>)[Symbol.for('webstir.backendTestContext')] as
    | { request(path: string, init?: RequestInit): Promise<Response> }
    | undefined;
  if (!context) throw new Error('Backend test context not available.');
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  headers.set('accept', 'text/html');
  return await context.request(pathname, { ...init, headers });
}

function csrf(html: string): string {
  return /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
}

function cookieFrom(response: Response, fallback = ''): string {
  const header = response.headers.get('set-cookie');
  return header ? (header.split(';')[0] ?? fallback) : fallback;
}
