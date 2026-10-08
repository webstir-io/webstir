import { afterAll, beforeAll, beforeEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import { closeAppDatabase } from '../dist/db/index.js';
import { ensureSessionCsrfToken } from '../dist/runtime/forms.js';
import { oidc, signIn } from '../dist/sign-in/index.js';
import { startOidcIssuer } from './support/oidcIssuer.js';

const REDIRECT = 'http://127.0.0.1:4321/sign-in/acme/callback/';
let issuer;

beforeAll(async () => {
  issuer = await startOidcIssuer();
});
afterAll(() => issuer.stop());
beforeEach(() => {
  Object.assign(issuer, {
    person: { sub: 'sub-ada', email: 'ada@example.com', email_verified: true },
    change: undefined,
    deny: false,
    signAsStranger: false,
    omitIdToken: false,
    unsigned: false,
    claimsToBe: undefined,
    tokenRequests: [],
  });
});

const provider = (extra = {}) =>
  oidc({
    id: 'acme',
    label: 'Acme',
    issuer: issuer.url,
    clientId: issuer.clientId,
    clientSecret: issuer.clientSecret,
    ...extra,
  });

/** Starts, lets the provider approve, and finishes; `alter` changes what comes back. */
async function through(acme, alter = () => {}) {
  const started = await acme.start({ redirectUri: REDIRECT });
  const url = await issuer.approve(started.location);
  const kept = structuredClone(started.keep);
  alter({ url, kept });
  return acme.finish({ url, redirectUri: REDIRECT, kept });
}

test('the visitor is sent to the provider with a state, a nonce and a PKCE challenge, and comes back as who it says', async () => {
  const acme = provider({ authorizeParams: { prompt: 'select_account' } });
  const started = await acme.start({ redirectUri: REDIRECT });
  const sent = new URL(started.location);
  const asked = Object.fromEntries(sent.searchParams);
  assert.equal(`${sent.origin}${sent.pathname}`, `${issuer.url}/authorize`);
  assert.deepEqual(
    {
      ...asked,
      state: asked.state === started.keep.state,
      nonce: asked.nonce === started.keep.nonce,
      code_challenge:
        asked.code_challenge.length > 20 && asked.code_challenge !== started.keep.verifier,
    },
    {
      prompt: 'select_account',
      client_id: 'app-client',
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid email profile',
      state: true,
      nonce: true,
      code_challenge: true,
      code_challenge_method: 'S256',
    },
  );
  assert.deepEqual(Object.keys(started.keep).sort(), ['nonce', 'state', 'verifier']);

  const url = await issuer.approve(started.location);
  const identity = await acme.finish({ url, redirectUri: REDIRECT, kept: started.keep });
  assert.deepEqual(identity, { subject: 'sub-ada', email: 'ada@example.com' });
  assert.deepEqual(issuer.tokenRequests, [
    {
      grant_type: 'authorization_code',
      code: url.searchParams.get('code'),
      redirect_uri: REDIRECT,
      code_verifier: started.keep.verifier,
      client_id: 'app-client',
      client_secret: 'app-secret',
    },
  ]);
  // Each visitor gets their own.
  const again = await acme.start({ redirectUri: REDIRECT });
  assert.notDeepEqual(again.keep, started.keep);
});

test('an answer the provider did not give, or one for someone else, is refused', async () => {
  const nothing = () => {};
  const cases = [
    [
      'a state that is not the one sent',
      /unexpected "state"/,
      ({ url }) => url.searchParams.set('state', 'another'),
    ],
    ['no state', /"state" missing/, ({ url }) => url.searchParams.delete('state')],
    [
      'a nonce that is not the one sent',
      /unexpected ID Token "nonce"/,
      ({ kept }) => (kept.nonce = 'another'),
    ],
    [
      'a verifier that is not the one sent',
      /error in the response body: invalid_grant/,
      ({ kept }) => (kept.verifier = 'x'.repeat(43)),
    ],
    [
      'a code that is not the one given',
      /error in the response body: invalid_grant/,
      ({ url }) => url.searchParams.set('code', 'another'),
    ],
    ['nothing kept', /nothing was kept/, ({ kept }) => delete kept.state],
    [
      'the visitor turned away at the provider',
      /authorization response from the server is an error: access_denied/,
      nothing,
      () => (issuer.deny = true),
    ],
    [
      'a token from another issuer',
      /unexpected JWT "iss"/,
      nothing,
      () => (issuer.change = (c) => (c.iss = 'https://evil.test')),
    ],
    [
      'a token for another app',
      /unexpected JWT "aud"/,
      nothing,
      () => (issuer.change = (c) => (c.aud = 'another-app')),
    ],
    [
      'a token that has expired',
      /expiration is past/,
      nothing,
      () => (issuer.change = (c) => (c.exp = c.iat - 3600)),
    ],
    [
      'a token with no nonce',
      /"nonce" \(nonce\) claim missing/,
      nothing,
      () => (issuer.change = (c) => delete c.nonce),
    ],
    [
      'a token with no subject',
      /"sub" \(subject\) claim missing/,
      nothing,
      () => (issuer.change = (c) => delete c.sub),
    ],
    [
      'a token someone else signed',
      /signature verification failed/,
      nothing,
      () => (issuer.signAsStranger = true),
    ],
    [
      'a token nobody signed',
      /unsupported JWS "alg" identifier|signature|alg/,
      nothing,
      () => (issuer.unsigned = true),
    ],
    [
      'no ID token',
      /"id_token" property must be a string/,
      nothing,
      () => (issuer.omitIdToken = true),
    ],
  ];
  for (const [name, why, alter, misbehave] of cases) {
    Object.assign(issuer, {
      change: undefined,
      deny: false,
      signAsStranger: false,
      omitIdToken: false,
      unsigned: false,
      claimsToBe: undefined,
    });
    misbehave?.();
    await assert.rejects(() => through(provider(), alter), why, name);
  }
  await assert.rejects(
    () => through(provider({ clientSecret: 'wrong' })),
    /error in the response body: invalid_client \(the secret is wrong\)/,
    'a wrong secret',
  );
});

test('an address the provider has not verified names nobody, unless the app reads the claims itself', async () => {
  for (const person of [
    { sub: 'sub-ada', email: 'ada@example.com', email_verified: false },
    { sub: 'sub-ada', email: 'ada@example.com' },
    { sub: 'sub-ada', email: 'ada@example.com', email_verified: 'true' },
  ]) {
    issuer.person = person;
    assert.deepEqual(await through(provider()), { subject: 'sub-ada', email: '' });
  }
  // A provider like Microsoft Entra: its own ids for the tenant and the person, and no flag.
  issuer.person = { sub: 'pairwise', tid: 'tenant-1', oid: 'object-9', email: 'Ada@Example.com' };
  const entra = provider({
    identity: (claims) => ({ subject: `${claims.tid}:${claims.oid}`, email: claims.email }),
  });
  assert.deepEqual(await through(entra), {
    subject: 'tenant-1:object-9',
    email: 'Ada@Example.com',
  });
});

test("the app's own parameters and scopes go along, but none the flow sets or depends on", async () => {
  const acme = provider({
    scopes: ['email', 'offline_access'],
    authorizeParams: { login_hint: 'ada@example.com', prompt: 'select_account' },
  });
  const started = await acme.start({ redirectUri: REDIRECT });
  const asked = new URL(started.location).searchParams;
  assert.equal(asked.get('login_hint'), 'ada@example.com');
  assert.equal(asked.get('prompt'), 'select_account');
  assert.equal(asked.get('scope'), 'openid email offline_access');

  for (const name of [
    'client_id',
    'redirect_uri',
    'response_type',
    'response_mode',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method',
    'request',
    'request_uri',
  ]) {
    assert.throws(
      () => provider({ authorizeParams: { prompt: 'login', [name]: 'chosen' } }),
      new RegExp(`authorizeParams cannot set ${name}; the flow sets or depends on it`),
      name,
    );
  }
  assert.throws(
    () => provider({ authorizeParams: { state: 'a', request: 'b' } }),
    /cannot set state, request; the flow sets or depends on them/,
  );
});

test('with max_age, a token must say when the person signed in, and recently enough', async () => {
  const acme = provider({ authorizeParams: { max_age: '300' } });
  const asked = new URL((await acme.start({ redirectUri: REDIRECT })).location).searchParams;
  assert.equal(asked.get('max_age'), '300');
  await assert.rejects(() => through(acme), /auth_time/);
  issuer.change = (claims) => (claims.auth_time = claims.iat - 3600);
  await assert.rejects(() => through(acme), /too much time has elapsed/);
  issuer.change = (claims) => (claims.auth_time = claims.iat - 10);
  assert.equal((await through(acme)).subject, 'sub-ada');
  assert.throws(
    () => provider({ authorizeParams: { max_age: 'soon' } }),
    /max_age must be a number/,
  );
});

test('a provider that is not who its address says it is cannot be used', async () => {
  issuer.claimsToBe = 'https://someone-else.test';
  const acme = provider();
  await assert.rejects(() => acme.start({ redirectUri: REDIRECT }), /issuer/);
  // Asked again once it answers as itself.
  issuer.claimsToBe = undefined;
  assert.equal(typeof (await acme.start({ redirectUri: REDIRECT })).location, 'string');
});

test('a provider says what it still needs, and does nothing without it', async () => {
  const full = { issuer: 'https://login.example.com', clientId: 'id', clientSecret: 'secret' };
  for (const [options, problem] of [
    [full, undefined],
    [{ ...full, issuer: undefined }, 'it has no issuer.'],
    [{ ...full, clientId: ' ' }, 'it has no clientId.'],
    [{ ...full, clientSecret: '' }, 'it has no clientSecret.'],
    [{ ...full, issuer: 'http://login.example.com' }, 'its issuer must be an https address.'],
    [{ ...full, issuer: issuer.url }, 'its issuer must be an https address.'],
  ]) {
    const acme = oidc({ id: 'acme', label: 'Acme', ...options });
    assert.equal(acme.setupProblem(), problem, JSON.stringify(options));
  }
  const unset = oidc({ id: 'acme', label: 'Acme', ...full, clientSecret: undefined });
  await assert.rejects(() => unset.start({ redirectUri: REDIRECT }), /it has no clientSecret/);
  assert.equal(oidc({ id: 'acme', label: 'Acme', ...full, allowSignUp: false }).allowSignUp, false);
  assert.equal('allowSignUp' in oidc({ id: 'acme', label: 'Acme', ...full }), false);
  // Without TLS only a provider on this machine is spoken to.
  const remote = oidc({ id: 'acme', label: 'Acme', ...full, issuer: 'http://login.example.com' });
  await assert.rejects(() => remote.start({ redirectUri: REDIRECT }));
});

test('through sign-in, a person from the provider becomes a signed-in user, or is told why not', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-sign-in-oidc-'));
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'sign-in-oidc-test-secret';
  prepareApp(root);
  try {
    const attempt = async (acme) => {
      const module = signIn({ emailCode: false, providers: [acme] });
      const route = (name) => module.routes.find((r) => r.definition.name === name).handler;
      const { session, token } = ensureSessionCsrfToken(null);
      const ctx = {
        request: new Request('http://127.0.0.1:4321/sign-in/acme/', { method: 'POST' }),
        body: { returnTo: '/notes/', _csrf: token },
        session,
      };
      const sent = await route('sign-in-acme')(ctx);
      const back = await issuer.approve(sent.redirect.location);
      assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
      const returned = { request: new Request(back), session: ctx.session };
      const result = await route('sign-in-acme-callback')(returned);
      return { result, session: returned.session };
    };

    const ada = await attempt(provider());
    assert.deepEqual([ada.result.status, ada.result.redirect.location], [303, '/notes/']);
    assert.equal(typeof ada.session.webstirUser.id, 'string');

    // Someone new whose address the provider has not verified has no address to be known by.
    issuer.person = { sub: 'sub-grace', email: 'grace@example.com', email_verified: false };
    const grace = await attempt(provider());
    assert.deepEqual(
      [grace.result.redirect.location, grace.result.flash[0].message, grace.session.webstirUser],
      ['/sign-in/', 'That account cannot sign in here.', undefined],
    );
    // Someone who signed in before still does, whatever the provider says of their address now.
    issuer.person = { sub: 'sub-ada', email: 'ada@example.com', email_verified: false };
    assert.deepEqual((await attempt(provider())).session.webstirUser, ada.session.webstirUser);

    for (const [name, identity] of [
      [
        'throws',
        () => {
          throw new Error('no such claim');
        },
      ],
      ['names nobody', () => undefined],
      ['gives a subject that is not text', () => ({ subject: 7, email: 'ada@example.com' })],
    ]) {
      const refused = await attempt(provider({ identity }));
      assert.deepEqual(
        [
          refused.result.redirect.location,
          refused.result.flash[0].message,
          refused.session.webstirUser,
        ],
        ['/sign-in/', 'Signing in with Acme did not finish. Try again.', undefined],
        name,
      );
    }
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
});
