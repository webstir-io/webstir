import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import { closeAppDatabase } from '../dist/db/index.js';
import { databaseTargets, openEmptyDatabase } from './support/databases.js';
import { ensureWebstirTables } from '../dist/db/webstir-tables.js';
import { ensureSessionCsrfToken } from '../dist/runtime/forms.js';
import { consumeCode, consumeToken, createChallenge } from '../dist/sign-in/challenges.js';
import { safeReturnTo, signIn } from '../dist/sign-in/index.js';
import { readSignInCode } from '../dist/sign-in/module.js';

const SECRET = 'sign-in-test-secret';

async function challenges(target) {
  const db = await openEmptyDatabase(target);
  await ensureWebstirTables(db, 'sign-in');
  return db;
}

const at = (minutes) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

for (const target of databaseTargets) {
  test(`${target.name}: a code works once, for five minutes; three wrong tries use it up`, async () => {
    const db = await challenges(target);
    const email = 'ada@example.com';
    const wrong = (code) => (code === '000000' ? '111111' : '000000');

    const first = await createChallenge(db, email, SECRET, at(0));
    assert.match(first.code, /^\d{6}$/);
    assert.equal(await consumeCode(db, email, first.code, SECRET, at(6)), false, 'expired');

    const second = await createChallenge(db, email, SECRET, at(10));
    assert.equal(
      await consumeCode(db, 'grace@example.com', second.code, SECRET, at(10)),
      false,
      'another address',
    );
    assert.equal(await consumeCode(db, email, second.code, SECRET, at(11)), true);
    assert.equal(await consumeCode(db, email, second.code, SECRET, at(11)), false, 'used');

    const third = await createChallenge(db, email, SECRET, at(20));
    for (let tries = 0; tries < 3; tries += 1) {
      assert.equal(await consumeCode(db, email, wrong(third.code), SECRET, at(20)), false);
    }
    assert.equal(await consumeCode(db, email, third.code, SECRET, at(20)), false, 'used up');
    await db.close();
  });

  test(`${target.name}: a link signs in once, and a new code replaces the address's open ones`, async () => {
    const db = await challenges(target);
    const old = await createChallenge(db, 'ada@example.com', SECRET, at(0));
    const current = await createChallenge(db, 'ada@example.com', SECRET, at(2));
    assert.equal(await consumeToken(db, old.token, SECRET, at(2)), undefined, 'replaced');
    assert.equal(await consumeToken(db, current.token, SECRET, at(3)), 'ada@example.com');
    assert.equal(await consumeToken(db, current.token, SECRET, at(3)), undefined, 'used');
    assert.equal(
      await consumeCode(db, 'ada@example.com', current.code, SECRET, at(3)),
      false,
      'the code went with it',
    );
    await db.close();
  });

  test(`${target.name}: an address turned away or asking too often does the same work, and changes nothing`, async () => {
    const db = await challenges(target);
    const email = 'ada@example.com';
    const live = await createChallenge(db, email, SECRET, at(0));
    assert.equal(
      await createChallenge(db, 'nobody@example.com', SECRET, at(0), { allowed: false }),
      undefined,
    );
    assert.equal(
      await createChallenge(db, email, SECRET, new Date(at(0).getTime() + 10_000)),
      undefined,
    );
    const rows = await db.query('SELECT email FROM webstir_sign_in_challenges');
    assert.deepEqual(
      rows.map((row) => row.email),
      [email],
    );
    assert.equal(
      await consumeCode(db, email, live.code, SECRET, at(1)),
      true,
      'the live code still works',
    );
    await db.close();
  });

  test(`${target.name}: an address gets one code a minute and five in fifteen minutes`, async () => {
    const db = await challenges(target);
    const email = 'ada@example.com';
    assert.ok(await createChallenge(db, email, SECRET, at(0)));
    assert.equal(
      await createChallenge(db, email, SECRET, new Date(at(0).getTime() + 30_000)),
      undefined,
    );
    for (const minute of [1, 2, 3, 4])
      assert.ok(await createChallenge(db, email, SECRET, at(minute)), `minute ${minute}`);
    assert.equal(
      await createChallenge(db, email, SECRET, at(5)),
      undefined,
      'sixth in fifteen minutes',
    );
    assert.ok(await createChallenge(db, email, SECRET, at(16)));
    await db.close();
  });
}

for (const target of databaseTargets) {
  test(`${target.name}: at the same time, only one sign-in uses a code or link, and every wrong try counts`, async () => {
    const db = await challenges(target);
    const email = 'ada@example.com';
    const wrong = (code) => (code === '000000' ? '111111' : '000000');

    const guessed = await createChallenge(db, email, SECRET, at(0));
    await Promise.all(
      Array.from({ length: 5 }, () => consumeCode(db, email, wrong(guessed.code), SECRET, at(0))),
    );
    assert.equal(
      await consumeCode(db, email, guessed.code, SECRET, at(0)),
      false,
      'three wrong tries use it up',
    );

    const code = await createChallenge(db, email, SECRET, at(2));
    const byCode = await Promise.all(
      Array.from({ length: 4 }, () => consumeCode(db, email, code.code, SECRET, at(2))),
    );
    assert.deepEqual(byCode.filter(Boolean).length, 1, 'one sign-in per code');

    const link = await createChallenge(db, email, SECRET, at(4));
    const byLink = await Promise.all(
      Array.from({ length: 4 }, () => consumeToken(db, link.token, SECRET, at(4))),
    );
    assert.deepEqual(byLink.filter(Boolean), [email], 'one sign-in per link');
    await db.close();
  });
}

test('a code resent while the old one signs someone in stays usable', async () => {
  const db = await challenges(databaseTargets[0]);
  const email = 'ada@example.com';
  const old = await createChallenge(db, email, SECRET, at(0));
  let resent;
  // Between the update that uses the old code and what follows it, a new code is sent.
  const racing = {
    ...db,
    get: db.get,
    query: db.query,
    transaction: db.transaction,
    async execute(sql, params) {
      const result = await db.execute(sql, params);
      if (!resent && /SET consumed_at = \?\s+WHERE id = \?/.test(sql)) {
        resent = await createChallenge(db, email, SECRET, at(2));
      }
      return result;
    },
  };
  assert.equal(await consumeCode(racing, email, old.code, SECRET, at(1)), true);
  assert.ok(resent);
  assert.equal(
    await consumeCode(db, email, resent.code, SECRET, at(3)),
    true,
    'the resent code works',
  );
  await db.close();
});

test('return addresses stay on the app, and never lead back to sign-in', () => {
  for (const [value, expected] of [
    ['/notes/', '/notes/'],
    ['/notes/?page=2#top', '/notes/?page=2#top'],
    ['https://evil.test/', '/'],
    ['//evil.test/', '/'],
    ['/.//evil.test', '/'],
    ['/a/..//evil.test/x', '/'],
    ['/%2e//evil.test', '/'],
    ['/notes/..//evil.test', '/'],
    ['/\\evil.test', '/'],
    ['notes', '/'],
    ['/sign-in/', '/'],
    ['/sign-out', '/'],
    ['/sign-in-help/', '/sign-in-help/'],
    [undefined, '/'],
    [['/a/', '/b/'], '/a/'],
  ]) {
    assert.equal(safeReturnTo(value), expected, JSON.stringify(value));
  }
});

test('an address the app turns away gets the same answer as any other, and no code', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-sign-in-'));
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
  prepareApp(root);
  try {
    const asked = [];
    const module = signIn({
      canSignIn: (email) => {
        asked.push(email);
        return email.endsWith('@example.com');
      },
    });
    const submit = module.routes[0].handler;
    const answers = [];
    for (const email of ['intruder@elsewhere.test', 'ada@example.com']) {
      const { session, token } = ensureSessionCsrfToken(null);
      const ctx = {
        request: new Request('http://127.0.0.1:4321/sign-in', { method: 'POST' }),
        body: { intent: 'request', email, _csrf: token },
        session,
      };
      const result = await submit(ctx);
      answers.push([result.status, result.redirect?.location, ctx.session.webstirSignIn.email]);
    }
    assert.deepEqual(asked, ['intruder@elsewhere.test', 'ada@example.com']);
    assert.deepEqual(answers, [
      [303, '/sign-in/', 'intruder@elsewhere.test'],
      [303, '/sign-in/', 'ada@example.com'],
    ]);
    // The email goes out in the background, so the answer takes the same time either way.
    const logFile = path.join(root, '.webstir', 'email.log');
    for (
      let waited = 0;
      waited < 2000 && !(await fs.stat(logFile).catch(() => undefined));
      waited += 20
    ) {
      await Bun.sleep(20);
    }
    const log = await fs.readFile(logFile, 'utf8');
    assert.equal(log.trim().split('\n').length, 1);
    assert.match(log, /"to":"ada@example.com"/);
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a code is read however it was typed or pasted', () => {
  for (const [value, expected] of [
    ['123456', '123456'],
    [' 123456 ', '123456'],
    ['123 456', '123456'],
    ['123-456', '123456'],
    ['1 2 3 4 5 6', '123456'],
    ['Your sign-in code is 123456. It works for 5 minutes.', '123456'],
    ['123456 is your sign-in code', '123456'],
    ['12345', undefined],
    ['1234567', undefined],
    ['', undefined],
    [undefined, undefined],
  ]) {
    assert.equal(readSignInCode(value), expected, JSON.stringify(value));
  }
});

test('someone signed in who opens sign-in goes on to where they were headed, while they may', async () => {
  const allowed = new Set(['ada@example.com']);
  const view = signIn({ canSignIn: (email) => allowed.has(email) }).views.find(
    (candidate) => candidate.definition.name === 'sign-in',
  );
  const load = (user) =>
    view.load({
      url: new URL('http://127.0.0.1:4321/sign-in/?returnTo=%2Fnotes%2F'),
      session: {},
      user,
      forms: { read: () => ({ errors: {} }) },
    });
  assert.equal((await load(null)).asking, true);
  await assert.rejects(
    async () => load({ id: 'user-1', email: 'ada@example.com' }),
    (error) => error.location === '/notes/',
  );
  // Turned away since, they get the form instead of being sent back to a page that sends them here.
  allowed.delete('ada@example.com');
  assert.equal((await load({ id: 'user-1', email: 'ada@example.com' })).asking, true);
});

test('a resent code says it is on its way', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-sign-in-'));
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
  prepareApp(root);
  try {
    const submit = signIn().routes[0].handler;
    const { session, token } = ensureSessionCsrfToken(null);
    const ctx = {
      request: new Request('http://127.0.0.1:4321/sign-in', { method: 'POST' }),
      body: { intent: 'request', email: 'ada@example.com', _csrf: token },
      session,
    };
    assert.equal((await submit(ctx)).flash, undefined);
    ctx.body = { intent: 'resend', _csrf: ensureSessionCsrfToken(ctx.session).token };
    const resent = await submit(ctx);
    assert.equal(resent.status, 303);
    assert.deepEqual(resent.flash, [
      {
        level: 'info',
        message:
          'If ada@example.com can sign in, a code is on its way. A new one can be sent once a minute. Codes are in the terminal and .webstir/email.log.',
      },
    ]);
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('someone turned away after their code was sent cannot use the code or the link', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-sign-in-'));
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
  prepareApp(root);
  try {
    const allowed = new Set(['ada@example.com', 'grace@example.com']);
    const module = signIn({ canSignIn: (email) => allowed.has(email) });
    const [submit, confirm] = module.routes.map((route) => route.handler);
    const form = (session, body) => {
      const { session: withToken, token } = ensureSessionCsrfToken(session);
      return {
        request: new Request('http://127.0.0.1:4321/sign-in', { method: 'POST' }),
        body: { ...body, _csrf: token },
        session: withToken,
      };
    };
    const logFile = path.join(root, '.webstir', 'email.log');
    const ask = async (email) => {
      const asking = form(null, { intent: 'request', email });
      await submit(asking);
      for (let waited = 0; waited < 2000; waited += 20) {
        const log = await fs.readFile(logFile, 'utf8').catch(() => '');
        const line = log.split('\n').find((entry) => entry.includes(`"to":"${email}"`));
        if (line) {
          const sent = JSON.parse(line);
          const code = /\b(\d{6})\b/.exec(sent.subject)[1];
          const token = new URL(/http\S+/.exec(sent.text)[0]).searchParams.get('token');
          return { session: asking.session, code, token };
        }
        await Bun.sleep(20);
      }
      assert.fail(`no code went to ${email}`);
    };

    // Turned away, the code is refused and stays unused, so it works once let back in.
    const ada = await ask('ada@example.com');
    allowed.delete('ada@example.com');
    assert.equal((await submit(form(ada.session, { intent: 'code', code: ada.code }))).status, 422);
    allowed.add('ada@example.com');
    const signedIn = form(ada.session, { intent: 'code', code: ada.code });
    assert.equal((await submit(signedIn)).status, 303);
    assert.ok(signedIn.session.webstirUser);

    // Turned away, the link is refused.
    const grace = await ask('grace@example.com');
    allowed.delete('grace@example.com');
    const byLink = form(null, { token: grace.token });
    assert.equal((await confirm(byLink)).status, 422);
    assert.equal(byLink.session.webstirUser, undefined);
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a link that has expired sends the visitor back to sign in, still headed where they were', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-sign-in-'));
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
  prepareApp(root);
  try {
    const module = signIn();
    const confirm = module.routes.find(
      (route) => route.definition.name === 'sign-in-confirm-submit',
    );
    const { session, token } = ensureSessionCsrfToken(null);
    const failed = await confirm.handler({
      request: new Request('http://127.0.0.1:4321/sign-in/confirm', { method: 'POST' }),
      body: { token: 'expired', returnTo: '/notes/', _csrf: token },
      session,
    });
    assert.equal(failed.status, 422);
    const view = module.views.find(
      (candidate) => candidate.definition.name === failed.rerender.view,
    );
    const page = await view.load({
      url: new URL('http://127.0.0.1:4321/sign-in/confirm/'),
      session: {},
      user: null,
      forms: {
        read: (id) =>
          id === failed.rerender.form.id
            ? {
                values: failed.rerender.form.values,
                errors: { form: failed.rerender.form.issues[0].message },
              }
            : { errors: {} },
      },
    });
    assert.deepEqual(
      [page.returnTo, page.asking, page.error],
      ['/notes/', true, 'This link has expired or was already used. Send yourself a new code.'],
    );
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('using a different email goes back to the email step with the address filled in', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-sign-in-'));
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
  prepareApp(root);
  try {
    const module = signIn();
    const submit = module.routes[0].handler;
    const view = module.views.find((candidate) => candidate.definition.name === 'sign-in');
    const post = async (session, body) => {
      const { session: withToken, token } = ensureSessionCsrfToken(session);
      const ctx = {
        request: new Request('http://127.0.0.1:4321/sign-in', { method: 'POST' }),
        body: { ...body, _csrf: token },
        session: withToken,
      };
      return { result: await submit(ctx), session: ctx.session };
    };
    const page = (session) =>
      view.load({
        url: new URL('http://127.0.0.1:4321/sign-in/'),
        session,
        user: null,
        forms: { read: () => ({ errors: {} }) },
      });

    const asked = await post(null, { intent: 'request', email: 'ada@example.com' });
    assert.deepEqual(
      [(await page(asked.session)).checking, (await page(asked.session)).email],
      [true, 'ada@example.com'],
    );
    const changing = await post(asked.session, { intent: 'change' });
    assert.equal(changing.result.status, 303);
    const emailStep = await page(changing.session);
    assert.deepEqual(
      [emailStep.asking, emailStep.checking, emailStep.email],
      [true, false, 'ada@example.com'],
    );
    // A code posted from the old step does nothing now.
    const late = await post(changing.session, { intent: 'code', code: '123456' });
    assert.deepEqual([late.result.status, late.session.webstirUser], [303, undefined]);
    // Asking again with another address moves on to its code.
    const other = await post(changing.session, { intent: 'request', email: 'grace@example.com' });
    assert.deepEqual(
      [(await page(other.session)).checking, (await page(other.session)).email],
      [true, 'grace@example.com'],
    );
  } finally {
    await closeAppDatabase();
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await fs.rm(root, { recursive: true, force: true });
  }
});
