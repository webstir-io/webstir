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
