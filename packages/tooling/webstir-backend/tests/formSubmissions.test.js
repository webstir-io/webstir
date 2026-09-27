import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { claimSubmission, forgetReissuedTo } from '../dist/runtime/form-submissions.js';
import { attachSessionMetadata } from '../dist/runtime/session-metadata.js';

const start = Date.parse('2026-01-01T00:00:00.000Z');
const at = (ms) => new Date(start + ms);

// Runs a submission whose answer moved the browser from `from` to the session `to`.
async function signIn(from, id, to, ms) {
  const claim = await claimSubmission(from, null, id, at(ms));
  assert.equal(claim.answered, undefined);
  const session = attachSessionMetadata(
    {},
    { id: to, createdAt: at(ms).toISOString(), expiresAt: at(ms + 3_600_000).toISOString() },
  );
  claim.record(session, 303, `/signed-in/${to}`, at(ms));
  claim.recordCookie({ session, setCookie: `webstir_session=${to}.signed` }, at(ms));
  claim.release();
}

async function answered(from, id, ms) {
  const claim = await claimSubmission(from, null, id, at(ms));
  claim.release();
  return claim.answered?.setCookie;
}

test('an answer that moved the browser to another session is kept only briefly', async () => {
  const cases = [
    // [what happens after the first answer, when the copy comes, what the copy gets]
    [() => {}, 59_999, 'webstir_session=new-0.signed'],
    [() => {}, 60_000, undefined],
    [() => forgetReissuedTo('new-2'), 1, undefined],
    [() => forgetReissuedTo('someone-else'), 1, 'webstir_session=new-3.signed'],
  ];
  for (const [index, [then, ms, expected]] of cases.entries()) {
    const from = `old-${index}`;
    await signIn(from, 'submission-0001', `new-${index}`, 0);
    then();
    assert.equal(await answered(from, 'submission-0001', ms), expected, String(index));
    assert.equal(await answered(`other-${index}`, 'submission-0001', 1), undefined, String(index));
  }
});

test('kept answers are bounded, oldest first', async () => {
  const ms = 10 * 60_000;
  for (let index = 0; index <= 1_000; index += 1) {
    await signIn(`bounded-${index}`, 'submission-0002', `bounded-new-${index}`, ms);
  }
  assert.equal(await answered('bounded-0', 'submission-0002', ms), undefined);
  assert.equal(
    await answered('bounded-1', 'submission-0002', ms),
    'webstir_session=bounded-new-1.signed',
  );
  assert.equal(
    await answered('bounded-1000', 'submission-0002', ms),
    'webstir_session=bounded-new-1000.signed',
  );
});
