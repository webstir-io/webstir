import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInMemorySessionStore,
  prepareSessionState,
  resetInMemorySessionStore,
} from '../dist/runtime/session.js';
import { prepareFormState } from '../dist/runtime/forms.js';

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
