import { afterAll, beforeAll, beforeEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import { closeAppDatabase } from '../dist/db/index.js';
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
      /error in the response body/,
      ({ kept }) => (kept.verifier = 'x'.repeat(43)),
    ],
    [
      'a code that is not the one given',
      /error in the response body/,
      ({ url }) => url.searchParams.set('code', 'another'),
    ],
    ['nothing kept', /nothing was kept/, ({ kept }) => delete kept.state],
    [
      'the visitor turned away at the provider',
      /authorization response from the server is an error/,
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
    });
    misbehave?.();
    await assert.rejects(() => through(provider(), alter), why, name);
  }
  await assert.rejects(
    () => through(provider({ clientSecret: 'wrong' })),
    /error in the response body/,
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

test("the app's own parameters and scopes go along, and cannot replace what the flow depends on", async () => {
  const acme = provider({
    scopes: ['email', 'offline_access'],
    authorizeParams: {
      login_hint: 'ada@example.com',
      state: 'chosen',
      redirect_uri: 'https://evil.test/',
      response_type: 'token',
      code_challenge_method: 'plain',
    },
  });
  const started = await acme.start({ redirectUri: REDIRECT });
  const asked = new URL(started.location).searchParams;
  assert.equal(asked.get('login_hint'), 'ada@example.com');
  assert.equal(asked.get('scope'), 'openid email offline_access');
  assert.equal(asked.get('state'), started.keep.state);
  assert.equal(asked.get('redirect_uri'), REDIRECT);
  assert.equal(asked.get('response_type'), 'code');
  assert.equal(asked.get('code_challenge_method'), 'S256');
  assert.equal(asked.getAll('state').length, 1);
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

test('through sign-in, a person from the provider becomes a signed-in user', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-sign-in-oidc-'));
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'sign-in-oidc-test-secret';
  prepareApp(root);
  try {
    const module = signIn({ emailCode: false, providers: [provider()] });
    const route = (name) => module.routes.find((r) => r.definition.name === name).handler;
    const ctx = {
      request: new Request('http://127.0.0.1:4321/sign-in/acme/?returnTo=%2Fnotes%2F'),
      session: null,
    };
    const sent = await route('sign-in-acme')(ctx);
    const back = await issuer.approve(sent.redirect.location);
    assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
    const returned = { request: new Request(back), session: ctx.session };
    const result = await route('sign-in-acme-callback')(returned);
    assert.deepEqual([result.status, result.redirect.location], [303, '/notes/']);
    assert.equal(typeof returned.session.webstirUser.id, 'string');
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
});
