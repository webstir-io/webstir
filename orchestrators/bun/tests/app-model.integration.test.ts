import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { Database } from 'bun:sqlite';

import { startPublishedWorkspaceServer } from '@webstir-io/webstir-backend';

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

// Who may do what: Ada edits, Grace is signed in without the role, and Nobody has no access.
const SIGN_IN = `import type { SignInOptions } from '@webstir-io/webstir-backend/sign-in';

const signIn: SignInOptions = {
  email: ({ code, link }) => ({
    subject: \`Your sign-in code: \${code}\`,
    text: \`Your sign-in code is \${code}.\\n\\n\${link}\\n\`,
  }),
  loadUser: (user) =>
    user.email === 'nobody@example.com'
      ? null
      : { ...user, roles: user.email === 'ada@example.com' ? ['editor'] : [] },
};

export default signIn;
`;

// A page only editors see, with the account in the shell and a form the runtime checks.
const EDITORS_MODULE = `import { fieldIssue } from '@webstir-io/webstir-backend/runtime/views';

const editorsView = {
  definition: { name: 'editors', path: '/editors', page: 'editors', auth: { role: 'editor' } },
  data: z.object({
    titles: z.array(z.string()),
    add: z.object({ title: z.string(), error: z.string() }),
    kept: z.string(),
  }),
  load: async (ctx: any) => {
    const add = ctx.forms.read('add-title');
    return {
      titles: (await ctx.db.query('SELECT body FROM notes ORDER BY body')).map((row: any) => row.body),
      add: { title: String(add.values.title ?? ''), error: add.errors.title ?? add.errors.form ?? '' },
      kept: ctx.forms.read('remove:First').errors.form ?? '',
    };
  },
};

const addTitle = {
  definition: {
    name: 'addTitle',
    method: 'POST' as const,
    path: '/editors',
    interaction: 'navigation' as const,
    auth: { role: 'editor' },
    session: { mode: 'optional' as const, write: true },
    form: { id: 'add-title', contentType: 'application/x-www-form-urlencoded' as const, csrf: true },
  },
  handler: async (ctx: any) => {
    const title = String(ctx.form.values.title ?? '').trim();
    if (!title) fieldIssue('title', 'Give it a title.');
    if (title === 'First' && (await ctx.db.query('SELECT 1 FROM notes WHERE body = ?', [title])).length > 0) {
      fieldIssue('title', 'Already listed.', { values: { title: 'First (2)' } });
    }
    await ctx.db.execute('INSERT INTO notes (id, body) VALUES (?, ?)', [crypto.randomUUID(), title]);
    return { status: 303, redirect: { location: '/editors/' } };
  },
};

// One form per title: a failure is read back by that title's form, not the route's.
const removeTitle = {
  definition: {
    name: 'removeTitle',
    method: 'POST' as const,
    path: '/editors/remove',
    interaction: 'navigation' as const,
    auth: { role: 'editor' },
    session: { mode: 'optional' as const, write: true },
    form: { id: 'remove-title', contentType: 'application/x-www-form-urlencoded' as const, csrf: true },
  },
  handler: (ctx: any) => fieldIssue(undefined, 'Kept for now.', { form: \`remove:\${ctx.form.values.title}\` }),
};

const shell = {
  data: z.object({ account: z.string().nullable() }),
  load: (ctx: any) => ({ account: ctx.user?.email ?? null }),
};
`;

const EDITORS_PAGE = [
  '<head><title>Editors</title></head>',
  '<body><main>',
  '  <p class="account" data-text="shell.account"></p>',
  '  <ul><li data-each="titles as title" data-text="title"></li></ul>',
  '  <form method="post" action="/editors/">',
  '    <p class="error" data-if="add.error" data-text="add.error"></p>',
  '    <input name="title" data-attr-value="add.title" />',
  '    <button type="submit">Add</button>',
  '  </form>',
  '  <p class="kept" data-if="kept" data-text="kept"></p>',
  '</main></body>',
  '',
].join('\n');

async function createEditorsApp(): Promise<string> {
  const workspace = await createBatteriesApp(copies);
  await writeFile(path.join(workspace, 'src', 'backend', 'sign-in.ts'), SIGN_IN, 'utf8');
  const page = path.join(workspace, 'src', 'frontend', 'pages', 'editors');
  await mkdir(page, { recursive: true });
  await writeFile(path.join(page, 'index.html'), EDITORS_PAGE, 'utf8');
  const modulePath = path.join(workspace, 'src', 'backend', 'module.ts');
  const source = await readFile(modulePath, 'utf8');
  const updated = `${source.replace(
    "import { processFormSubmission } from '@webstir-io/webstir-backend/runtime/forms';",
    `import { processFormSubmission } from '@webstir-io/webstir-backend/runtime/forms';\n${EDITORS_MODULE}`,
  )}`
    .replace(
      'routes: [...routes, addNote, me],',
      'routes: [...routes, addNote, me, addTitle, removeTitle],',
    )
    .replace('views: [notesView],', 'views: [notesView, editorsView],\n  shell,');
  expect(updated).toContain('views: [notesView, editorsView]');
  await writeFile(modulePath, updated, 'utf8');
  return workspace;
}

function createBrowser(origin: string) {
  let cookie = '';
  return {
    async request(
      pathname: string,
      init: RequestInit & { form?: Record<string, string>; from?: string } = {},
    ) {
      const headers = new Headers(init.headers);
      if (cookie) headers.set('cookie', cookie);
      headers.set('accept', 'text/html');
      if (init.from) headers.set('referer', `${origin}${init.from}`);
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

type Browser = ReturnType<typeof createBrowser>;

async function signIn(
  browser: Browser,
  smtp: ReturnType<typeof startSmtpServer>,
  email: string,
): Promise<void> {
  const asking = await (await browser.request('/sign-in/')).text();
  const sent = smtp.messages.length;
  await browser.request('/sign-in/', {
    method: 'POST',
    form: { intent: 'request', email, _csrf: csrfTokenFrom(asking) },
  });
  await waitFor(() => expect(smtp.messages.length).toBe(sent + 1), 10_000);
  const code = /code is (\d{6})/.exec(smtp.messages[sent]?.data ?? '')?.[1];
  const checking = await (await browser.request('/sign-in/')).text();
  const done = await browser.request('/sign-in/', {
    method: 'POST',
    form: { intent: 'code', code: String(code), _csrf: csrfTokenFrom(checking) },
  });
  expect(done.status).toBe(303);
}

const submissionIdFrom = (html: string) =>
  /name="_webstir_submission" value="([^"]+)"/.exec(html)?.[1] ?? '';

test('an app says who its users are and what they may do; forms, repeats and the shell are the runtime’s', async () => {
  const workspace = await createEditorsApp();
  await runPublish({ workspaceRoot: workspace });
  const smtp = startSmtpServer();
  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = await startPublishedWorkspaceServer({
    workspaceRoot: workspace,
    port,
    host: '127.0.0.1',
    env: {
      NODE_ENV: 'production',
      SESSION_SECRET: 'a-long-random-secret-for-this-test-only',
      APP_URL: origin,
      EMAIL_URL: smtp.url,
      EMAIL_FROM: 'App <app@example.com>',
      WEBSTIR_JOBS: 'off',
      SNAPSHOT_URL: 'file:./data/snapshots',
    },
    io: { stdout: { write: () => true }, stderr: { write: () => true } },
  });
  try {
    // Signed out, a page that needs a role sends the visitor to sign in first.
    const visitor = createBrowser(origin);
    const signedOut = await visitor.request('/editors/');
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.get('location')).toBe('/sign-in/?returnTo=%2Feditors%2F');

    // An editor sees it, with the shell's data, and a form that carries its own submission id.
    const ada = createBrowser(origin);
    await signIn(ada, smtp, 'ada@example.com');
    const page = await ada.request('/editors/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<p class="account">ada@example.com</p>');
    const id = submissionIdFrom(html);
    expect(id).not.toBe('');

    // The runtime checks the form's token before the action runs.
    const forged = await ada.request('/editors/', {
      method: 'POST',
      from: '/editors/',
      form: { title: 'forged', _csrf: 'wrong' },
    });
    expect(forged.status).toBe(403);
    expect(await forged.text()).toContain('Form session expired');

    // A fieldIssue sends the form back to its page, with what was typed.
    const empty = await ada.request('/editors/', {
      method: 'POST',
      from: '/editors/',
      form: { title: '  ', _csrf: csrfTokenFrom(html), _webstir_submission: id },
    });
    expect(empty.status).toBe(422);
    const emptyHtml = await empty.text();
    expect(emptyHtml).toContain('<p class="error">Give it a title.</p>');

    // The same submission sent twice, as a resent post without script would, is answered once.
    const fresh = submissionIdFrom(emptyHtml);
    const form = { title: 'First', _csrf: csrfTokenFrom(emptyHtml), _webstir_submission: fresh };
    const first = await ada.request('/editors/', { method: 'POST', from: '/editors/', form });
    const again = await ada.request('/editors/', { method: 'POST', from: '/editors/', form });
    expect([first.status, again.status]).toEqual([303, 303]);
    expect(again.headers.get('location')).toBe(first.headers.get('location'));
    const listed = await (await ada.request('/editors/')).text();
    expect(listed.match(/<li>First<\/li>/g)).toHaveLength(1);

    // An issue can offer other values than those typed, and name another form's state.
    const duplicate = await ada.request('/editors/', {
      method: 'POST',
      from: '/editors/',
      form: { title: 'First', _csrf: csrfTokenFrom(listed) },
    });
    const duplicateHtml = await duplicate.text();
    expect(duplicateHtml).toContain('<p class="error">Already listed.</p>');
    expect(duplicateHtml).toContain('value="First (2)"');
    const kept = await ada.request('/editors/remove', {
      method: 'POST',
      from: '/editors/',
      form: { title: 'First', _csrf: csrfTokenFrom(duplicateHtml) },
    });
    const keptHtml = await kept.text();
    expect(keptHtml).toContain('<p class="kept">Kept for now.</p>');
    expect(keptHtml).not.toContain('<p class="error">');

    // Signed in without the role, the page and its form are not there.
    const grace = createBrowser(origin);
    await signIn(grace, smtp, 'grace@example.com');
    expect((await grace.request('/editors/')).status).toBe(404);
    const gracePost = await grace.request('/editors/', {
      method: 'POST',
      from: '/editors/',
      form: { title: 'x' },
    });
    expect(gracePost.status).toBe(404);
    expect((await grace.request('/notes/')).status).toBe(200);

    // A failed form never shows a page its sender could not open, whatever Referer names it.
    for (const [who, browser, status] of [
      ['signed out', visitor, 303],
      ['without the role', grace, 404],
    ] as const) {
      const failed = await browser.request('/sign-in/', {
        method: 'POST',
        from: '/editors/',
        form: { intent: 'request', email: 'someone@example.com', _csrf: 'wrong' },
      });
      expect([who, failed.status]).toEqual([who, status]);
      expect(await failed.text()).not.toContain('<ul>');
      if (status === 303)
        expect(failed.headers.get('location')).toStartWith('/sign-in/?returnTo=%2Feditors');
    }

    // Someone the app gives no access is treated as signed out.
    const nobody = createBrowser(origin);
    await signIn(nobody, smtp, 'nobody@example.com');
    expect((await nobody.request('/notes/')).status).toBe(303);
    expect(await (await nobody.request('/sign-in/')).text()).toContain(
      'This account has no access here.',
    );

    // Stopping the server, as a deploy does, takes the snapshot the last write is waiting for.
    const last = await (await ada.request('/editors/')).text();
    await ada.request('/editors/', {
      method: 'POST',
      from: '/editors/',
      form: { title: 'Last', _csrf: csrfTokenFrom(last) },
    });
    await server.stop();
    const folder = path.join(workspace, 'data', 'snapshots');
    const newest = (await readdir(folder))
      .filter((name) => name.endsWith('.sqlite'))
      .sort()
      .at(-1);
    const copy = new Database(path.join(folder, String(newest)), { readonly: true });
    expect(copy.query("SELECT body FROM notes WHERE body = 'Last'").all()).toHaveLength(1);
    copy.close();
  } finally {
    await server.stop();
    smtp.stop();
  }
}, 240_000);
