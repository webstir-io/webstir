import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { claimSubmission } from '../dist/runtime/form-submissions.js';
import { attachSessionMetadata } from '../dist/runtime/session-metadata.js';

const start = Date.parse('2026-01-01T00:00:00.000Z');
const at = (ms) => new Date(start + ms);

// Runs a submission from the session `from` whose commit left the session `to` (null: none).
async function submit(from, id, to, ms, setCookie = `webstir_session=${to}.signed`) {
  const claim = await claimSubmission(from, null, id, at(ms));
  assert.equal(claim.answered, undefined);
  const session =
    to === null
      ? null
      : attachSessionMetadata(
          {},
          { id: to, createdAt: at(ms).toISOString(), expiresAt: at(ms + 3_600_000).toISOString() },
        );
  claim.record(session, 303, `/signed-in/${to}`, at(ms));
  claim.recordCookie({ session, setCookie }, at(ms));
  claim.release();
}

async function answered(from, id, ms) {
  const claim = await claimSubmission(from, null, id, at(ms));
  claim.release();
  return claim.answered?.setCookie;
}

test('only an answer that started a new session is kept, and only briefly', async () => {
  const cases = [
    // [the session the commit left, the cookie it set, when the copy comes, what the copy gets]
    ['new', undefined, 59_999, 'webstir_session=new.signed'],
    ['new', undefined, 60_000, undefined],
    [null, 'webstir_session=; Max-Age=0', 1, undefined],
    ['same', undefined, 1, undefined],
  ];
  for (const [index, [to, setCookie, ms, expected]] of cases.entries()) {
    const from = `old-${index}`;
    const left = to === 'same' ? from : to === null ? null : `${to}-${index}`;
    await submit(from, 'submission-0001', left, 0, setCookie ?? `webstir_session=${left}.signed`);
    const got = await answered(from, 'submission-0001', ms);
    assert.equal(got, expected && `webstir_session=${left}.signed`, String(index));
    assert.equal(await answered(`other-${index}`, 'submission-0001', 1), undefined, String(index));
  }
});

test('kept answers are bounded, oldest first, and only new sessions count', async () => {
  const ms = 10 * 60_000;
  await submit('bounded-0', 'submission-0002', 'bounded-new-0', ms);
  // One stale cookie posting again and again only expires itself: nothing is kept for it.
  for (let index = 0; index < 1_000; index += 1) {
    await submit('stale', `stale-${String(index).padStart(4, '0')}`, null, ms, 'webstir_session=');
  }
  assert.equal(
    await answered('bounded-0', 'submission-0002', ms),
    'webstir_session=bounded-new-0.signed',
  );
  for (let index = 1; index <= 1_000; index += 1) {
    await submit(`bounded-${index}`, 'submission-0002', `bounded-new-${index}`, ms);
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
