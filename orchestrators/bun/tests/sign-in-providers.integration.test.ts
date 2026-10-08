import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';

import { startPublishedWorkspaceServer } from '@webstir-io/webstir-backend';

import { runPublish } from '../src/publish.ts';
import { createBatteriesApp } from '../test-support/batteries-app.ts';
import { cookieFrom } from '../test-support/render-workspace.ts';
import { removeDemoWorkspace, type DemoWorkspaceCopy } from '../test-support/demo-workspace.ts';
import { getFreePort } from '../test-support/watch.ts';

const copies: DemoWorkspaceCopy[] = [];

afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => removeDemoWorkspace(copy)));
});

/**
 * Sign-in through a provider only. The provider here trusts whoever the address it is called
 * back at names, once the state it handed out comes back with them.
 */
const SIGN_IN = `import type { SignInOptions, SignInProvider } from '@webstir-io/webstir-backend/sign-in';

const acme: SignInProvider = {
  id: 'acme',
  label: 'Acme',
  setupProblem: () => (process.env.ACME_SECRET ? undefined : 'ACME_SECRET is not set.'),
  async start({ redirectUri }) {
    const state = crypto.randomUUID();
    return {
      location: 'https://acme.test/authorize?state=' + state + '&redirect_uri=' + encodeURIComponent(redirectUri),
      keep: { state },
    };
  },
  async finish({ url, kept }) {
    if (url.searchParams.get('state') !== kept.state) throw new Error('state does not match');
    const email = url.searchParams.get('as') ?? '';
    return { subject: 'acme:' + email, email };
  },
};

const signIn: SignInOptions = {
  emailCode: false,
  providers: [acme],
  canSignIn: (email) => email.endsWith('@example.com'),
};

export default signIn;
`;

function createBrowser(origin: string) {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async get(pathname: string, accept = 'text/html') {
      const response = await fetch(`${origin}${pathname}`, {
        headers: { accept, ...(cookie ? { cookie } : {}) },
        redirect: 'manual',
      });
      cookie = cookieFrom(response, cookie);
      return response;
    },
  };
}

test('a full app whose people sign in through a provider, with no email set up', async () => {
  const workspace = await createBatteriesApp(copies);
  await writeFile(path.join(workspace, 'src', 'backend', 'sign-in.ts'), SIGN_IN, 'utf8');
  await runPublish({ workspaceRoot: workspace });

  const port = await getFreePort();
  const origin = `http://127.0.0.1:${port}`;
  const production = {
    NODE_ENV: 'production',
    SESSION_SECRET: 'a-long-random-secret-for-this-test-only',
    APP_URL: origin,
    WEBSTIR_JOBS: 'off',
  };

  // Production asks the provider what it needs, and never for email.
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(workspace, 'build', 'backend', 'index.js')],
    cwd: workspace,
    env: { ...process.env, ...production, PORT: String(await getFreePort()) },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  expect(code).not.toBe(0);
  expect(stderr).toContain('sign-in with Acme is not set up: ACME_SECRET is not set.');
  expect(stderr).not.toContain('EMAIL_URL');

  const server = await startPublishedWorkspaceServer({
    workspaceRoot: workspace,
    port,
    host: '127.0.0.1',
    env: { ...production, ACME_SECRET: 'set' },
    io: { stdout: { write: () => true }, stderr: { write: () => true } },
  });
  try {
    const ada = createBrowser(origin);
    const guarded = await ada.get('/notes/');
    expect(guarded.headers.get('location')).toBe('/sign-in/?returnTo=%2Fnotes%2F');

    const page = await (await ada.get('/sign-in/?returnTo=%2Fnotes%2F')).text();
    expect(page).toContain('href="/sign-in/acme/?returnTo=%2Fnotes%2F"');
    expect(page).toContain('Sign in with <span>Acme</span>');
    expect(page).not.toContain('Send me a code');
    expect(page).not.toContain('data-each');

    /** Leaves for the provider, and returns the state it was sent with. */
    const leave = async (browser: ReturnType<typeof createBrowser>) => {
      const sent = await browser.get('/sign-in/acme/?returnTo=%2Fnotes%2F');
      expect(sent.status).toBe(303);
      const location = new URL(sent.headers.get('location') ?? '');
      expect(location.origin).toBe('https://acme.test');
      expect(location.searchParams.get('redirect_uri')).toBe(`${origin}/sign-in/acme/callback/`);
      return location.searchParams.get('state') ?? '';
    };
    const back = (state: string, email: string) =>
      `/sign-in/acme/callback/?state=${state}&as=${encodeURIComponent(email)}`;

    // An answer with the wrong state signs nobody in, and uses up what was waiting.
    const state = await leave(ada);
    const forged = await ada.get(back('not-the-state', 'ada@example.com'));
    expect(forged.headers.get('location')).toBe('/sign-in/');
    expect(await (await ada.get('/sign-in/')).text()).toContain(
      'Signing in with Acme did not finish. Try again.',
    );
    expect((await ada.get(back(state, 'ada@example.com'))).headers.get('location')).toBe(
      '/sign-in/',
    );
    // Said once.
    expect(await (await ada.get('/sign-in/')).text()).toContain('Signing in with Acme did not');
    expect(await (await ada.get('/sign-in/')).text()).not.toContain('Signing in with Acme did not');

    const before = ada.cookie;
    const signedIn = await ada.get(back(await leave(ada), 'Ada@Example.com'));
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get('location')).toBe('/notes/');
    expect(ada.cookie).not.toBe(before);
    const me = await ada.get('/api/me', 'application/json');
    expect(await me.json()).toEqual({ email: 'ada@example.com' });
    expect((await ada.get('/notes/')).status).toBe(200);
    // Signed in, the sign-in page sends them on.
    expect((await ada.get('/sign-in/?returnTo=%2Fnotes%2F')).headers.get('location')).toBe(
      '/notes/',
    );

    // Someone the app turns away comes back to sign-in, signed out.
    const eve = createBrowser(origin);
    const refused = await eve.get(back(await leave(eve), 'eve@elsewhere.test'));
    expect(refused.headers.get('location')).toBe('/sign-in/');
    expect(await (await eve.get('/sign-in/')).text()).toContain(
      'That account cannot sign in here.',
    );
    expect((await eve.get('/api/me', 'application/json')).status).toBe(401);
  } finally {
    await server.stop();
  }
}, 240_000);
