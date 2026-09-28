import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';

import { startPublishedWorkspaceServer } from '@webstir-io/webstir-backend';

import { formatJobsResult, runJobsCommand } from '../src/jobs-command.ts';
import { runPublish } from '../src/publish.ts';
import { createBatteriesApp } from '../test-support/batteries-app.ts';
import { cookieFrom, csrfTokenFrom } from '../test-support/render-workspace.ts';
import { removeDemoWorkspace, type DemoWorkspaceCopy } from '../test-support/demo-workspace.ts';
import { startSmtpServer } from '../test-support/smtp.ts';
import { getFreePort, waitFor } from '../test-support/watch.ts';

const copies: DemoWorkspaceCopy[] = [];

afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => removeDemoWorkspace(copy)));
});

/** A browser's cookie, carried across requests. */
function createBrowser(origin: string) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value;
    },
    async request(pathname: string, init: RequestInit & { form?: Record<string, string> } = {}) {
      const headers = new Headers(init.headers);
      if (cookie) headers.set('cookie', cookie);
      if (!headers.has('accept')) headers.set('accept', 'text/html');
      let body = init.body;
      if (init.form) {
        headers.set('content-type', 'application/x-www-form-urlencoded');
        headers.set('origin', origin);
        body = new URLSearchParams(init.form).toString();
      }
      const response = await fetch(`${origin}${pathname}`, {
        ...init,
        body,
        headers,
        redirect: 'manual',
      });
      cookie = cookieFrom(response, cookie);
      return response;
    },
  };
}

test('a full app with batteries: emailed sign-in, a guarded page, durable sessions, migrations, jobs and files', async () => {
  const workspace = await createBatteriesApp(copies);
  await runPublish({ workspaceRoot: workspace });

  const smtp = startSmtpServer();
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-long-random-secret-for-this-test-only',
    APP_URL: origin,
    EMAIL_URL: smtp.url,
    EMAIL_FROM: 'App <app@example.com>',
  };
  const start = () =>
    startPublishedWorkspaceServer({
      workspaceRoot: workspace,
      port,
      host: '127.0.0.1',
      env,
      io: { stdout: { write: () => true }, stderr: { write: () => true } },
    });
  let server = await start();
  try {
    const ada = createBrowser(origin);
    // A guarded page sends a signed-out visitor to sign in, and back.
    const guarded = await ada.request('/notes/');
    expect(guarded.status).toBe(303);
    expect(guarded.headers.get('location')).toBe('/sign-in/?returnTo=%2Fnotes%2F');

    const asking = await ada.request('/sign-in/?returnTo=%2Fnotes%2F');
    expect(asking.status).toBe(200);
    const askingHtml = await asking.text();
    expect(askingHtml).toContain('Send me a code');
    const requested = await ada.request('/sign-in/', {
      method: 'POST',
      form: {
        intent: 'request',
        email: 'Ada@Example.com',
        returnTo: '/notes/',
        _csrf: csrfTokenFrom(askingHtml),
      },
    });
    expect(requested.status).toBe(303);
    await waitFor(() => expect(smtp.messages).toHaveLength(1), 10_000);
    const mail = smtp.messages[0];
    expect(mail?.to).toEqual(['ada@example.com']);
    const code = /code is (\d{6})/.exec(mail?.data ?? '')?.[1];
    expect(code).toBeDefined();

    const checking = await (await ada.request('/sign-in/')).text();
    expect(checking).toContain('ada@example.com');
    const wrong = await ada.request('/sign-in/', {
      method: 'POST',
      form: {
        intent: 'code',
        code: code === '000000' ? '111111' : '000000',
        _csrf: csrfTokenFrom(checking),
      },
    });
    expect(wrong.status).toBe(422);
    const wrongHtml = await wrong.text();
    expect(wrongHtml).toContain('That code is wrong or has expired');
    const before = ada.cookie;
    const signedIn = await ada.request('/sign-in/', {
      method: 'POST',
      form: { intent: 'code', code: String(code), _csrf: csrfTokenFrom(wrongHtml) },
    });
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get('location')).toBe('/notes/');
    expect(ada.cookie).not.toBe(before);

    const api = await ada.request('/api/me', { headers: { accept: 'application/json' } });
    expect(await api.json()).toEqual({ email: 'ada@example.com' });

    const notes = await ada.request('/notes/');
    expect(notes.status).toBe(200);
    const notesHtml = await notes.text();
    expect(notesHtml).toContain('ada@example.com');
    const added = await ada.request('/notes/', {
      method: 'POST',
      form: { body: 'hello', _csrf: csrfTokenFrom(notesHtml) },
    });
    expect(added.status).toBe(303);

    // The migration made the table; the queued job and the scheduled job both wrote to it.
    await waitFor(async () => {
      const html = await (await ada.request('/notes/')).text();
      expect(html).toContain('<li>hello</li>');
      expect(html).toContain('<li>job:hello</li>');
      expect(html).toContain('<li>tick</li>');
    }, 15_000);
    expect(
      await readFile(path.join(workspace, 'data', 'files', 'notes', 'hello.txt'), 'utf8'),
    ).toBe('hello');

    // A magic link signs in through a POST, so a link scanner's GET uses nothing up.
    const grace = createBrowser(origin);
    const graceAsking = await (await grace.request('/sign-in/?returnTo=%2Fnotes%2F')).text();
    await grace.request('/sign-in/', {
      method: 'POST',
      form: {
        intent: 'request',
        email: 'grace@example.com',
        returnTo: '/notes/',
        _csrf: csrfTokenFrom(graceAsking),
      },
    });
    await waitFor(() => expect(smtp.messages).toHaveLength(2), 10_000);
    const link = /(http:\/\/127\.0\.0\.1:\d+\/sign-in\/confirm\/\?\S+)/.exec(
      smtp.messages[1]?.data ?? '',
    )?.[1];
    expect(link).toBeDefined();
    const confirm = await grace.request(
      new URL(String(link)).pathname + new URL(String(link)).search,
    );
    expect(confirm.status).toBe(200);
    const confirmHtml = await confirm.text();
    const token = /name="token" value="([^"]+)"/.exec(confirmHtml)?.[1];
    const confirmed = await grace.request('/sign-in/confirm/', {
      method: 'POST',
      form: { token: String(token), returnTo: '/notes/', _csrf: csrfTokenFrom(confirmHtml) },
    });
    expect(confirmed.status).toBe(303);
    expect(await (await grace.request('/notes/')).text()).toContain('grace@example.com');

    // Asking again within the minute gets the same answer, and no email.
    const again = await (await grace.request('/sign-in/')).text();
    const repeat = await grace.request('/sign-in/', {
      method: 'POST',
      form: { intent: 'request', email: 'grace@example.com', _csrf: csrfTokenFrom(again) },
    });
    expect(repeat.status).toBe(303);
    await Bun.sleep(300);
    expect(smtp.messages).toHaveLength(2);

    // Sessions live in the database: a restart keeps Ada signed in.
    await server.stop();
    server = await start();
    expect((await ada.request('/notes/')).status).toBe(200);

    // Signing out everywhere ends her other sessions too.
    const other = createBrowser(origin);
    other.cookie = ada.cookie;
    const signOut = await ada.request('/sign-out/', { method: 'POST', form: { everywhere: '1' } });
    expect(signOut.status).toBe(303);
    expect((await other.request('/notes/')).status).toBe(303);
    // A signed-out form post is sent to sign in; an API call is told it needs to.
    const post = await other.request('/notes/', { method: 'POST', form: { body: 'x' } });
    expect(post.status).toBe(303);
    expect(post.headers.get('location')).toStartWith('/sign-in/?returnTo=');
    const call = await other.request('/api/me', { headers: { accept: 'application/json' } });
    expect(call.status).toBe(401);
    expect(await call.json()).toEqual({
      errors: [{ code: 'sign_in_required', message: 'Sign in to use this.' }],
    });
  } finally {
    await server.stop();
    smtp.stop();
  }

  // The queue kept the job that failed, with its error.
  const listing = formatJobsResult(await runJobsCommand({ workspaceRoot: workspace, args: [] }));
  expect(listing).toContain('failed broken');
  expect(listing).toContain('broken on purpose');
  expect(listing).toContain('tick  rate(1 seconds)');
}, 240_000);

test('a server app refuses to start when its setup is wrong: a failing migration, or sign-in without email in production', async () => {
  const workspace = await createBatteriesApp(copies);
  await writeFile(
    path.join(workspace, 'src', 'backend', 'migrations', '0002-broken.sql'),
    'INSERT INTO nowhere (id) VALUES (1);\n',
    'utf8',
  );
  await runPublish({ workspaceRoot: workspace });
  const run = async (env: Record<string, string>) => {
    const child = Bun.spawn({
      cmd: [process.execPath, path.join(workspace, 'build', 'backend', 'index.js')],
      cwd: workspace,
      env: { ...process.env, PORT: String(await getFreePort()), WEBSTIR_JOBS: 'off', ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
    return { stderr, code };
  };

  const migrating = await run({ NODE_ENV: 'development' });
  expect(migrating.code).not.toBe(0);
  expect(migrating.stderr).toContain('migration src/backend/migrations/0002-broken.sql failed');
  expect(migrating.stderr).toContain('nowhere');

  const noEmail = await run({
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-long-random-secret-for-this-test-only',
    APP_URL: 'https://example.com',
  });
  expect(noEmail.code).not.toBe(0);
  expect(noEmail.stderr).toContain('EMAIL_URL is not set');

  // A page that needs a signed-in user, in an app without sign-in.
  await rm(path.join(workspace, 'src', 'backend', 'sign-in.ts'));
  await rm(path.join(workspace, 'src', 'backend', 'migrations', '0002-broken.sql'));
  for (const page of ['sign-in', 'sign-in-confirm']) {
    await rm(path.join(workspace, 'src', 'frontend', 'pages', page), { recursive: true });
  }
  await runPublish({ workspaceRoot: workspace });
  const unguarded = await run({ NODE_ENV: 'development' });
  expect(unguarded.code).not.toBe(0);
  expect(unguarded.stderr).toContain("auth: 'required', but the app has no sign-in");
  expect(existsSync(path.join(workspace, 'data'))).toBe(true);
  expect(
    (await readdir(path.join(workspace, 'data'))).some((file) => file.startsWith('app.sqlite')),
  ).toBe(true);
}, 240_000);
