import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInMemorySessionStore,
  prepareSessionState,
  resetInMemorySessionStore,
} from '../dist/runtime/session.js';
import { prepareFormState, processFormSubmission } from '../dist/runtime/forms.js';

const config = {
  secret: 'test-session-secret',
  cookieName: 'webstir_session',
  secure: false,
  maxAgeSeconds: 60,
};

const loginRoute = {
  form: {
    session: { write: true },
    flash: {
      publish: [{ key: 'signed-in', level: 'success', when: 'success' }],
    },
  },
};

const accountRoute = {
  session: { mode: 'optional' },
  flash: { consume: ['signed-in'] },
};

test('prepareSessionState honors an injected in-memory store boundary', () => {
  const store = createInMemorySessionStore();
  resetInMemorySessionStore();

  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store,
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
      data: { email: 'ada@example.com' },
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' },
    },
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);

  const globalRead = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config,
  });
  assert.equal(globalRead.session, null);
  assert.deepEqual(globalRead.flash, []);

  const scopedRead = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config,
    store,
  });
  assert.equal(scopedRead.session?.userId, 'ada@example.com');
  assert.deepEqual(
    scopedRead.flash.map((message) => ({ key: message.key, level: message.level })),
    [{ key: 'signed-in', level: 'success' }],
  );
});

test('prepareSessionState clears expired records and stale or tampered cookies on commit', () => {
  const store = createInMemorySessionStore();
  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' },
    },
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);
  const sessionId = extractSessionId(cookieHeader, config.cookieName);
  const stored = store.get(sessionId);

  assert.ok(stored, 'expected stored session record');
  store.set({
    ...stored,
    expiresAt: '2025-12-31T23:59:59.000Z',
  });

  const expired = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config,
    store,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  assert.equal(expired.session, null);
  assert.equal(store.get(sessionId), undefined);
  const expiredCommit = expired.commit({
    session: expired.session,
    route: accountRoute,
    result: { status: 200 },
  });
  assert.match(String(expiredCommit.setCookie), /^webstir_session=;.*Max-Age=0/);

  const tampered = prepareSessionState({
    cookies: cookieHeader.replace(/\.[^.;]+/, '.invalid-signature'),
    route: accountRoute,
    config,
    store,
  });
  assert.equal(tampered.session, null);
  const tamperedCommit = tampered.commit({
    session: tampered.session,
    route: accountRoute,
    result: { status: 200 },
  });
  assert.match(String(tamperedCommit.setCookie), /^webstir_session=;.*Max-Age=0/);
});

test('resetInMemorySessionStore clears an injected in-memory store', () => {
  const store = createInMemorySessionStore();

  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store,
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' },
    },
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);

  resetInMemorySessionStore(store);

  const afterReset = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config,
    store,
  });
  assert.equal(afterReset.session, null);
  assert.deepEqual(afterReset.flash, []);
});

test('prepareSessionState preserves session ids for updates and rotates after clearing', () => {
  const store = createInMemorySessionStore();
  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store,
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' },
    },
  });
  const firstCookie = extractCookieHeader(createdCommit.setCookie);
  const firstId = extractSessionId(firstCookie, config.cookieName);

  const read = prepareSessionState({
    cookies: firstCookie,
    route: accountRoute,
    config,
    store,
  });
  const updatedCommit = read.commit({
    session: {
      ...read.session,
      theme: 'dark',
    },
    route: accountRoute,
    result: { status: 200 },
  });
  assert.equal(updatedCommit.setCookie, undefined);
  assert.ok(store.get(firstId), 'expected ordinary session updates to keep the current id');

  const cleared = prepareSessionState({
    cookies: firstCookie,
    route: accountRoute,
    config,
    store,
  });
  const clearedCommit = cleared.commit({
    session: null,
    route: accountRoute,
    result: { status: 303, redirect: { location: '/signed-out' } },
  });
  assert.match(String(clearedCommit.setCookie), /^webstir_session=;.*Max-Age=0/);
  assert.equal(store.get(firstId), undefined);

  const recreated = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store,
  });
  const recreatedCommit = recreated.commit({
    session: {
      userId: 'ada@example.com',
    },
    route: loginRoute,
    result: { status: 303, redirect: { location: '/session/account' } },
  });
  const nextId = extractSessionId(
    extractCookieHeader(recreatedCommit.setCookie),
    config.cookieName,
  );
  assert.notEqual(nextId, firstId);
});

test('processFormSubmission consumes valid csrf tokens so replay fails with retry state', () => {
  const route = {
    path: '/account/settings',
    form: { csrf: true },
  };
  const page = prepareFormState({
    session: null,
    formId: 'account-settings',
    route,
  });

  const validationFailure = processFormSubmission({
    session: page.session,
    body: {
      _csrf: page.csrfToken,
      email: 'invalid-email',
    },
    auth: { source: 'service-token' },
    formId: 'account-settings',
    route,
    redirectTo: route.path,
    validate(values) {
      return typeof values.email === 'string' && values.email.includes('@')
        ? []
        : [{ field: 'email', message: 'Enter a valid email address.' }];
    },
  });
  assert.equal(validationFailure.ok, false);

  const replay = processFormSubmission({
    session: validationFailure.session,
    body: {
      _csrf: page.csrfToken,
      email: 'ada@example.com',
    },
    auth: { source: 'service-token' },
    formId: 'account-settings',
    route,
    redirectTo: route.path,
  });
  assert.equal(replay.ok, false);
  assert.deepEqual(replay.issues, [
    {
      code: 'csrf',
      message: 'Form session expired. Reload the page and try again.',
    },
  ]);

  const retryPage = prepareFormState({
    session: replay.session,
    formId: 'account-settings',
    route,
  });
  assert.equal(retryPage.values.email, 'ada@example.com');
  assert.deepEqual(retryPage.issues, [
    {
      code: 'csrf',
      message: 'Form session expired. Reload the page and try again.',
    },
  ]);
  assert.notEqual(retryPage.csrfToken, page.csrfToken);
});

test('prepareSessionState migrates legacy embedded form runtime without leaking the old payload key', () => {
  const store = createInMemorySessionStore();
  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store,
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' },
    },
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);
  const sessionId = extractSessionId(cookieHeader, config.cookieName);
  const existing = store.get(sessionId);

  assert.ok(existing, 'expected stored session record');

  store.set({
    ...existing,
    value: {
      ...existing.value,
      __webstir_form_runtime: {
        csrf: {
          profile: 'csrf-token-123',
        },
        states: {
          profile: {
            values: {
              email: 'ada@example.com',
            },
            issues: [
              {
                code: 'validation',
                field: 'email',
                message: 'Enter a valid email address.',
              },
            ],
            createdAt: existing.createdAt,
          },
        },
      },
    },
    runtime: undefined,
    flash: [],
  });

  const read = prepareSessionState({
    cookies: cookieHeader,
    config,
    store,
  });
  assert.equal(read.session?.userId, 'ada@example.com');
  assert.equal(Object.hasOwn(read.session ?? {}, '__webstir_form_runtime'), false);

  const page = prepareFormState({
    session: read.session,
    formId: 'profile',
    route: {
      path: '/account/settings',
      form: { csrf: true },
    },
  });

  assert.equal(page.values.email, 'ada@example.com');
  assert.deepEqual(page.issues, [
    {
      code: 'validation',
      field: 'email',
      message: 'Enter a valid email address.',
    },
  ]);
  assert.equal(page.csrfToken, 'csrf-token-123');
  assert.equal(Object.hasOwn(page.session, '__webstir_form_runtime'), false);
});

test('prepareSessionState keeps session metadata accessible without persisting it inside the app payload', () => {
  const store = createInMemorySessionStore();
  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store,
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' },
    },
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);
  const sessionId = extractSessionId(cookieHeader, config.cookieName);
  const stored = store.get(sessionId);

  assert.ok(stored, 'expected stored session record');
  assert.equal(Object.hasOwn(stored.value, 'id'), false);
  assert.equal(Object.hasOwn(stored.value, 'createdAt'), false);
  assert.equal(Object.hasOwn(stored.value, 'expiresAt'), false);
  assert.equal(stored.id, sessionId);

  const read = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config,
    store,
  });
  assert.equal(read.session?.id, sessionId);
  assert.match(String(read.session?.createdAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.match(String(read.session?.expiresAt), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(Object.hasOwn(read.session ?? {}, 'id'), true);
  assert.equal(Object.keys(read.session ?? {}).includes('id'), false);
  assert.equal(Object.keys(read.session ?? {}).includes('createdAt'), false);
  assert.equal(Object.keys(read.session ?? {}).includes('expiresAt'), false);
});

test('prepareSessionState stores flash in runtime metadata while preserving legacy top-level flash reads', () => {
  const store = createInMemorySessionStore();
  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store,
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' },
    },
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);
  const sessionId = extractSessionId(cookieHeader, config.cookieName);
  const stored = store.get(sessionId);

  assert.ok(stored, 'expected stored session record');
  assert.equal(Object.hasOwn(stored, 'flash'), false);
  assert.deepEqual(
    (stored.runtime?.flash ?? []).map((message) => ({ key: message.key, level: message.level })),
    [{ key: 'signed-in', level: 'success' }],
  );

  store.set({
    ...stored,
    flash: stored.runtime?.flash ?? [],
    runtime: undefined,
  });

  const read = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config,
    store,
  });
  assert.equal(read.session?.userId, 'ada@example.com');
  assert.deepEqual(
    read.flash.map((message) => ({ key: message.key, level: message.level })),
    [{ key: 'signed-in', level: 'success' }],
  );
});

function extractCookieHeader(setCookie) {
  assert.ok(setCookie, 'expected a session cookie');
  return String(setCookie).split(';')[0];
}

function extractSessionId(cookieHeader, cookieName) {
  const [nameValue] = String(cookieHeader).split(';');
  const prefix = `${cookieName}=`;
  assert.ok(nameValue.startsWith(prefix), `expected ${cookieName} cookie`);
  const encodedValue = nameValue.slice(prefix.length);
  const separatorIndex = encodedValue.indexOf('.');
  assert.notEqual(separatorIndex, -1, 'expected signed session cookie');
  return decodeURIComponent(encodedValue.slice(0, separatorIndex));
}
