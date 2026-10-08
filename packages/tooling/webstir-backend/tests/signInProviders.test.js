import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import { closeAppDatabase } from '../dist/db/index.js';
import { ensureWebstirTables } from '../dist/db/webstir-tables.js';
import { ensureSessionCsrfToken } from '../dist/runtime/forms.js';
import { isSessionRenewed } from '../dist/runtime/session-metadata.js';
import { signInDatabase } from '../dist/sign-in/database.js';
import { findIdentityUser, linkIdentity } from '../dist/sign-in/identities.js';
import { signIn } from '../dist/sign-in/index.js';
import { oneLine } from '../dist/sign-in/providers.js';
import { signInSetupProblem } from '../dist/sign-in/setup.js';
import { databaseTargets, openEmptyDatabase } from './support/databases.js';

const ORIGIN = 'http://127.0.0.1:4321';

/** A provider that says whoever `answer` names came back, and records what it was asked. */
function fakeProvider(answer, extra = {}) {
  const calls = [];
  return {
    id: 'acme',
    label: 'Acme',
    calls,
    async start({ redirectUri }) {
      calls.push(['start', redirectUri]);
      return { location: 'https://acme.test/authorize?state=s1', keep: { state: 's1' } };
    },
    async finish({ url, redirectUri, kept }) {
      calls.push(['finish', `${url.pathname}${url.search}`, redirectUri, kept]);
      return answer();
    },
    ...extra,
  };
}

async function withApp(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-sign-in-providers-'));
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'sign-in-providers-test-secret';
  prepareApp(root);
  try {
    await run();
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
}

const routesOf = (module) => {
  const named = (name) => module.routes.find((route) => route.definition.name === name)?.handler;
  return { start: named('sign-in-acme'), callback: named('sign-in-acme-callback') };
};

/** The sign-in page's form for a provider, posted from a visitor's own page. */
function startContext(returnTo = '/notes/') {
  const { session, token } = ensureSessionCsrfToken(null);
  return {
    request: new Request(`${ORIGIN}/sign-in/acme/`, { method: 'POST' }),
    body: { returnTo, _csrf: token },
    session,
  };
}

/** Goes to the provider and comes back, as one browser would. */
async function signInThrough(module, returnTo = '/notes/') {
  const { start, callback } = routesOf(module);
  const ctx = startContext(returnTo);
  const sent = await start(ctx);
  const back = {
    request: new Request(`${ORIGIN}/sign-in/acme/callback/?code=c1&state=s1`),
    session: ctx.session,
  };
  return { sent, kept: structuredClone(ctx.session), result: await callback(back), back };
}

for (const target of databaseTargets) {
  test(`${target.name}: a provider's person becomes the user with their address, and stays that user`, async () => {
    const db = await openEmptyDatabase(target);
    await ensureWebstirTables(db, 'sign-in');
    const ada = { provider: 'acme', subject: 'sub-ada', email: 'ada@example.com' };

    assert.equal(await findIdentityUser(db, 'acme', 'sub-ada'), undefined);
    assert.equal(await linkIdentity(db, ada, { create: false }), undefined, 'nobody to be');
    assert.deepEqual(await db.query('SELECT id FROM users'), []);

    const made = await linkIdentity(db, ada, { create: true });
    assert.deepEqual(await findIdentityUser(db, 'acme', 'sub-ada'), {
      ...made,
      email: 'ada@example.com',
    });
    assert.equal(await findIdentityUser(db, 'other', 'sub-ada'), undefined, 'per provider');

    // Someone the app already knows by address is that user, with no sign-up needed.
    await db.execute(
      "INSERT INTO users (id, email, session_version, created_at) VALUES ('u-grace', 'grace@example.com', 3, 'now')",
    );
    const grace = { provider: 'acme', subject: 'sub-grace', email: 'grace@example.com' };
    assert.deepEqual(await linkIdentity(db, grace, { create: false }), {
      id: 'u-grace',
      version: 3,
    });

    // An identity whose user is gone finds nobody, and links again to whoever has the address.
    await db.execute("DELETE FROM users WHERE id = 'u-grace'");
    assert.equal(await findIdentityUser(db, 'acme', 'sub-grace'), undefined);
    const again = await linkIdentity(db, grace, { create: true });
    assert.equal((await findIdentityUser(db, 'acme', 'sub-grace')).id, again.id);
    await db.close();
  });
}

test('a visitor goes to the provider and comes back signed in, in a new session, where they were headed', async () => {
  await withApp(async () => {
    const provider = fakeProvider(() => ({ subject: 'sub-ada', email: 'Ada@Example.com' }));
    const { sent, kept, result, back } = await signInThrough(signIn({ providers: [provider] }));

    assert.deepEqual(
      [sent.status, sent.redirect.location],
      [303, 'https://acme.test/authorize?state=s1'],
    );
    assert.deepEqual(kept.webstirSignInProvider, {
      provider: 'acme',
      returnTo: '/notes/',
      kept: { state: 's1' },
    });
    const redirectUri = `${ORIGIN}/sign-in/acme/callback/`;
    assert.deepEqual(provider.calls, [
      ['start', redirectUri],
      ['finish', '/sign-in/acme/callback/?code=c1&state=s1', redirectUri, { state: 's1' }],
    ]);

    assert.deepEqual([result.status, result.redirect.location], [303, '/notes/']);
    assert.equal(isSessionRenewed(back.session), true);
    assert.deepEqual(Object.keys(back.session), ['webstirUser'], 'nothing rides along');
    const user = await findIdentityUser(await signInDatabase(), 'acme', 'sub-ada');
    assert.deepEqual(back.session.webstirUser, { id: user.id, version: user.version });
    assert.equal(user.email, 'ada@example.com');
  });
});

test('someone who signed in before is the same user, and is asked about by the address the app knows', async () => {
  await withApp(async () => {
    const asked = [];
    let email = 'ada@example.com';
    const module = signIn({
      providers: [fakeProvider(() => ({ subject: 'sub-ada', email }))],
      canSignIn: (address) => {
        asked.push(address);
        return true;
      },
    });
    const first = await signInThrough(module);
    email = 'ada@new-name.test';
    const second = await signInThrough(module);
    assert.equal(second.back.session.webstirUser.id, first.back.session.webstirUser.id);
    // First about the one address there is; later about the one the app knows and the new one.
    assert.deepEqual(asked, ['ada@example.com', 'ada@example.com', 'ada@new-name.test']);
  });
});

test('an answer that cannot be trusted, or a person who may not sign in, is sent back signed out', async () => {
  const unfinished = 'Signing in with Acme did not finish. Try again.';
  const noAccess = 'That account cannot sign in here.';
  const ada = () => ({ subject: 'sub-ada', email: 'ada@example.com' });
  const cases = [
    [
      'the provider refuses the answer',
      {},
      () => Promise.reject(new Error('bad state')),
      unfinished,
    ],
    [
      'the provider names nobody',
      {},
      () => ({ subject: ' ', email: 'ada@example.com' }),
      unfinished,
    ],
    [
      'there is no usable address',
      {},
      () => ({ subject: 'sub-ada', email: 'not-an-address' }),
      noAccess,
    ],
    ['the app turns the address away', { canSignIn: () => false }, ada, noAccess],
    ['sign-up is off and nobody has the address', { allowSignUp: false }, ada, noAccess],
  ];
  for (const [name, { allowSignUp, ...options }, answer, message] of cases) {
    await withApp(async () => {
      const provider = fakeProvider(answer, allowSignUp === false ? { allowSignUp } : {});
      const { result, back } = await signInThrough(signIn({ ...options, providers: [provider] }));
      assert.deepEqual(
        [result.status, result.redirect.location, result.flash],
        [303, '/sign-in/', [{ level: 'error', message }]],
        name,
      );
      assert.equal(back.session.webstirUser, undefined, name);
      assert.equal(back.session.webstirSignInProvider, undefined, `${name}: used once`);
      const db = await signInDatabase();
      assert.deepEqual(await db.query('SELECT id FROM users'), [], `${name}: no user made`);
    });
  }
});

test('an answer nobody here asked for, or one used already, signs nobody in', async () => {
  await withApp(async () => {
    const provider = fakeProvider(() => ({ subject: 'sub-ada', email: 'ada@example.com' }));
    const { callback } = routesOf(signIn({ providers: [provider] }));
    const request = new Request(`${ORIGIN}/sign-in/acme/callback/?code=c1&state=s1`);
    for (const session of [
      null,
      {},
      { webstirSignInProvider: { provider: 'other', returnTo: '/', kept: { state: 's1' } } },
    ]) {
      const ctx = { request, session };
      const result = await callback(ctx);
      assert.equal(result.redirect.location, '/sign-in/');
      assert.equal(result.flash[0].level, 'error');
      assert.equal(ctx.session?.webstirUser, undefined);
    }
    assert.deepEqual(provider.calls, [], 'the provider is never asked');

    const { back } = await signInThrough(signIn({ providers: [provider] }));
    const replayed = await callback({ request, session: back.session });
    assert.equal(replayed.redirect.location, '/sign-in/');
  });
});

test('a provider that cannot start, or starts with nothing to go on, sends the visitor back to sign in', async () => {
  for (const [name, start] of [
    ['cannot be reached', () => Promise.reject(new Error('discovery failed'))],
    ['answers nothing', async () => undefined],
    ['gives no location', async () => ({ keep: { state: 's1' } })],
    ['gives an empty location', async () => ({ location: '', keep: {} })],
    ['keeps nothing', async () => ({ location: 'https://acme.test/authorize' })],
  ]) {
    const { start: route } = routesOf(signIn({ providers: [fakeProvider(() => ({}), { start })] }));
    const ctx = startContext();
    const result = await route(ctx);
    assert.deepEqual(
      [result.redirect.location, result.flash[0].level],
      ['/sign-in/', 'error'],
      name,
    );
    assert.equal(ctx.session.webstirSignInProvider, undefined, name);
  }
});

test("only the sign-in page's own form starts a sign-in", async () => {
  const provider = fakeProvider(() => ({}));
  const module = signIn({ providers: [provider] });
  const { start } = routesOf(module);
  const definition = module.routes.find(
    (route) => route.definition.name === 'sign-in-acme',
  ).definition;
  assert.deepEqual([definition.method, definition.form.csrf], ['POST', true]);
  const { session, token } = ensureSessionCsrfToken(null);
  for (const [name, ctx] of [
    ['no token', { body: { returnTo: '/notes/' }, session: { ...session } }],
    [
      'a wrong token',
      { body: { returnTo: '/notes/', _csrf: `${token}x` }, session: { ...session } },
    ],
    ['no session', { body: { returnTo: '/notes/', _csrf: token }, session: null }],
  ]) {
    ctx.request = new Request(`${ORIGIN}/sign-in/acme/`, { method: 'POST' });
    const result = await start(ctx);
    assert.notEqual(result.redirect?.location, 'https://acme.test/authorize?state=s1', name);
    assert.equal(ctx.session?.webstirSignInProvider, undefined, name);
  }
  assert.deepEqual(provider.calls, [], 'the provider is never asked');
});

test('an address that now belongs to someone else at the provider does not make them its user', async () => {
  await withApp(async () => {
    let subject = 'sub-ada';
    const module = signIn({
      providers: [fakeProvider(() => ({ subject, email: 'ada@example.com' }))],
    });
    const first = await signInThrough(module);
    assert.equal(typeof first.back.session.webstirUser.id, 'string');
    subject = 'sub-newcomer';
    const second = await signInThrough(module);
    assert.deepEqual(
      [second.result.redirect.location, second.result.flash, second.back.session.webstirUser],
      ['/sign-in/', [{ level: 'error', message: 'That account cannot sign in here.' }], undefined],
    );
    const db = await signInDatabase();
    assert.deepEqual(await db.query('SELECT subject FROM webstir_sign_in_identities'), [
      { subject: 'sub-ada' },
    ]);
    // The person it has always been still signs in.
    subject = 'sub-ada';
    const third = await signInThrough(module);
    assert.deepEqual(third.back.session.webstirUser, first.back.session.webstirUser);
  });
});

test('someone the app would turn away under the address the provider gives now is turned away', async () => {
  await withApp(async () => {
    let email = 'ada@corp.test';
    const module = signIn({
      providers: [fakeProvider(() => ({ subject: 'sub-ada', email }))],
      canSignIn: (address) => address.endsWith('@corp.test'),
    });
    assert.equal((await signInThrough(module)).result.redirect.location, '/notes/');
    email = 'ada@elsewhere.test';
    const moved = await signInThrough(module);
    assert.equal(moved.result.redirect.location, '/sign-in/');
    assert.equal(moved.back.session.webstirUser, undefined);
    // An address the provider no longer vouches for leaves the one the app knows them by.
    email = '';
    assert.equal((await signInThrough(module)).result.redirect.location, '/notes/');
  });
});

test('where the visitor was headed stays on the app through a provider', async () => {
  await withApp(async () => {
    const provider = fakeProvider(() => ({ subject: 'sub-ada', email: 'ada@example.com' }));
    for (const [asked, lands] of [
      ['//evil.test/', '/'],
      ['https://evil.test/', '/'],
      ['/sign-in/acme/', '/'],
      ['/notes/?page=2', '/notes/?page=2'],
    ]) {
      const { result } = await signInThrough(signIn({ providers: [provider] }), asked);
      assert.equal(result.redirect.location, lands, asked);
    }
  });
});

test('the sign-in page offers each provider, and only providers when email codes are off', async () => {
  const provider = fakeProvider(() => ({}));
  const load = (module, session = {}) =>
    module.views
      .find((view) => view.definition.name === 'sign-in')
      .load({
        url: new URL(`${ORIGIN}/sign-in/?returnTo=%2Fnotes%2F%3Fpage%3D2`),
        session,
        user: null,
        forms: { read: () => ({ errors: {} }) },
      });
  const link = [{ id: 'acme', label: 'Acme', action: '/sign-in/acme/' }];
  const pending = { webstirSignIn: { email: 'ada@example.com', returnTo: '/' } };

  const plain = await load(signIn());
  assert.deepEqual([plain.asking, plain.providers], [true, []]);

  const both = signIn({ providers: [provider] });
  assert.deepEqual([(await load(both)).asking, (await load(both)).providers], [true, link]);
  const checking = await load(both, pending);
  assert.deepEqual([checking.checking, checking.providers], [true, []], 'not beside the code step');

  const only = signIn({ emailCode: false, providers: [provider] });
  const page = await load(only, pending);
  assert.deepEqual([page.asking, page.checking, page.providers], [false, false, link]);
  const refused = await load(only, { webstirUser: { id: 'gone', version: 1 } });
  assert.equal(refused.error, 'This account has no access here. Sign in with another account.');
});

test('with email codes off, the code forms send nothing and sign nobody in', async () => {
  await withApp(async () => {
    const module = signIn({ emailCode: false, providers: [fakeProvider(() => ({}))] });
    const handler = (name) => module.routes.find((route) => route.definition.name === name).handler;
    for (const [name, body] of [
      ['sign-in-submit', { intent: 'request', email: 'ada@example.com' }],
      ['sign-in-confirm-submit', { token: 'anything' }],
    ]) {
      const { session, token } = ensureSessionCsrfToken(null);
      const ctx = {
        request: new Request(`${ORIGIN}/sign-in`, { method: 'POST' }),
        body: { ...body, _csrf: token },
        session,
      };
      const result = await handler(name)(ctx);
      assert.deepEqual([result.status, result.redirect.location], [303, '/sign-in/'], name);
      assert.equal(ctx.session.webstirSignIn, undefined, name);
      assert.equal(ctx.session.webstirUser, undefined, name);
    }
    const log = path.join(process.cwd(), '.webstir', 'email.log');
    await Bun.sleep(50);
    assert.equal(await fs.stat(log).catch(() => undefined), undefined, 'no email');
  });
});

test('options nobody could sign in with, or whose providers would collide, are refused', () => {
  const provider = (id) => ({ ...fakeProvider(() => ({})), id });
  assert.throws(() => signIn({ emailCode: false }), /nobody could sign in/);
  assert.throws(() => signIn({ emailCode: false, providers: [] }), /nobody could sign in/);
  for (const id of ['', 'Acme', 'a/b', 'a.b', '-a', '1a', 'confirm', undefined, null, 7]) {
    assert.throws(() => signIn({ providers: [provider(id)] }), /cannot be one/, String(id));
  }
  for (const [name, broken] of [
    ['no label', { label: '' }],
    ['no start', { start: undefined }],
    ['no finish', { finish: 'later' }],
  ]) {
    assert.throws(
      () => signIn({ providers: [{ ...provider('acme'), ...broken }] }),
      /needs a label, and start and finish functions/,
      name,
    );
  }
  assert.throws(() => signIn({ providers: [provider('acme'), provider('acme')] }), /two providers/);
  assert.doesNotThrow(() => signIn({ providers: [provider('acme'), provider('acme-2')] }));
});

test('production needs what each way of signing in needs, and no more', () => {
  const saved = { ...process.env };
  const provider = (problem) => ({ ...fakeProvider(() => ({})), setupProblem: () => problem });
  try {
    process.env.APP_URL = 'https://app.example.com';
    delete process.env.EMAIL_URL;
    delete process.env.EMAIL_FROM;
    assert.match(signInSetupProblem({}), /sign-in sends codes by email, but EMAIL_URL/);
    assert.match(signInSetupProblem({ providers: [provider()] }), /EMAIL_URL/, 'codes still on');
    assert.equal(signInSetupProblem({ emailCode: false, providers: [provider()] }), undefined);
    assert.equal(
      signInSetupProblem({
        emailCode: false,
        providers: [provider('ACME_CLIENT_SECRET is not set.')],
      }),
      'sign-in with Acme is not set up: ACME_CLIENT_SECRET is not set.',
    );
    process.env.EMAIL_URL = 'smtp://localhost:2525';
    process.env.EMAIL_FROM = 'app@example.com';
    assert.equal(signInSetupProblem({}), undefined);
  } finally {
    for (const key of ['APP_URL', 'EMAIL_URL', 'EMAIL_FROM']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

test('what a provider or a visitor said went wrong is one line of the log, and not a long one', async () => {
  assert.equal(
    oneLine('access_denied (no\n[sign-in] acme: everything is fine\r\n\u2028next\u0000)'),
    'access_denied (no [sign-in] acme: everything is fine next )',
  );
  assert.equal(oneLine(`  ${'x'.repeat(900)}  `), `${'x'.repeat(500)}...`);
  assert.equal(
    oneLine('invalid_client (the secret is wrong)'),
    'invalid_client (the secret is wrong)',
  );

  // Through the route: the reason a callback gives reaches the log as one line.
  const logged = [];
  const saved = console.error;
  console.error = (line) => logged.push(line);
  try {
    const provider = fakeProvider(() =>
      Promise.reject(new Error('denied\n[sign-in] forged: line')),
    );
    const { callback } = routesOf(signIn({ providers: [provider] }));
    await callback({
      request: new Request(`${ORIGIN}/sign-in/acme/callback/`),
      session: {
        webstirSignInProvider: { provider: 'acme', returnTo: '/', kept: { state: 's1' } },
      },
    });
  } finally {
    console.error = saved;
  }
  assert.deepEqual(logged, ['[sign-in] acme: denied [sign-in] forged: line']);
});
