import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createInMemorySessionStore,
  prepareSessionState,
  resetInMemorySessionStore
} from '../dist/runtime/session.js';

const config = {
  secret: 'test-session-secret',
  cookieName: 'webstir_session',
  secure: false,
  maxAgeSeconds: 60
};

const loginRoute = {
  form: {
    session: { write: true },
    flash: {
      publish: [{ key: 'signed-in', level: 'success', when: 'success' }]
    }
  }
};

const accountRoute = {
  session: { mode: 'optional' },
  flash: { consume: ['signed-in'] }
};

test('prepareSessionState honors an injected in-memory store boundary', () => {
  const store = createInMemorySessionStore();
  resetInMemorySessionStore();

  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
      data: { email: 'ada@example.com' }
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' }
    }
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);

  const globalRead = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config
  });
  assert.equal(globalRead.session, null);
  assert.deepEqual(globalRead.flash, []);

  const scopedRead = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config,
    store
  });
  assert.equal(scopedRead.session?.userId, 'ada@example.com');
  assert.deepEqual(
    scopedRead.flash.map((message) => ({ key: message.key, level: message.level })),
    [{ key: 'signed-in', level: 'success' }]
  );
});

test('resetInMemorySessionStore clears an injected in-memory store', () => {
  const store = createInMemorySessionStore();

  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config,
    store
  });
  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com'
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' }
    }
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);

  resetInMemorySessionStore(store);

  const afterReset = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config,
    store
  });
  assert.equal(afterReset.session, null);
  assert.deepEqual(afterReset.flash, []);
});

function extractCookieHeader(setCookie) {
  assert.ok(setCookie, 'expected a session cookie');
  return String(setCookie).split(';')[0];
}
