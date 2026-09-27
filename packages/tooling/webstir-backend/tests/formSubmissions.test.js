import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { claimSubmission } from '../dist/runtime/form-submissions.js';
import { attachSessionMetadata } from '../dist/runtime/session-metadata.js';

const start = Date.parse('2026-01-01T00:00:00.000Z');
const at = (ms) => new Date(start + ms);
const sessionWithId = (id, ms) =>
  attachSessionMetadata(
    {},
    { id, createdAt: at(ms).toISOString(), expiresAt: at(ms + 3_600_000).toISOString() },
  );

// Runs a submission from the session `from` (live or already ended) whose commit set `setCookie`.
async function submit({ from, live = true, id, setCookie, ms }) {
  const claim = await claimSubmission(from, live ? sessionWithId(from, ms) : null, id, at(ms));
  assert.equal(claim.answered, undefined);
  claim.record(null, 303, `/next/${id}`, at(ms));
  claim.recordCookie({ session: null, setCookie }, at(ms));
  claim.release();
}

async function answered(from, id, ms) {
  const claim = await claimSubmission(from, null, id, at(ms));
  claim.release();
  return claim.answered?.setCookie;
}

test('only an answer that moved a live session on is kept, and only briefly', async () => {
  const cases = [
    // [the session the post came from, the cookie its commit set, when the copy comes, kept]
    [{ live: true }, 'webstir_session=new.signed', 59_999, true],
    [{ live: true }, 'webstir_session=new.signed', 60_000, false],
    [{ live: true }, 'webstir_session=; Max-Age=0', 1, true],
    [{ live: true }, undefined, 1, false],
    [{ live: false }, 'webstir_session=new.signed', 1, false],
    [{ live: false }, 'webstir_session=; Max-Age=0', 1, false],
  ];
  for (const [index, [{ live }, setCookie, ms, kept]] of cases.entries()) {
    const from = `old-${index}`;
    await submit({ from, live, id: 'submission-0001', setCookie, ms: 0 });
    assert.equal(
      await answered(from, 'submission-0001', ms),
      kept ? setCookie : undefined,
      String(index),
    );
    assert.equal(await answered(`other-${index}`, 'submission-0001', 1), undefined, String(index));
  }
});

test('kept answers are bounded, oldest first, and an ended session keeps none', async () => {
  const ms = 10 * 60_000;
  const cookie = (index) => `webstir_session=bounded-new-${index}.signed`;
  await submit({ from: 'bounded-0', id: 'submission-0002', setCookie: cookie(0), ms });
  // One stale cookie posting again and again keeps nothing, so it crowds nothing out.
  for (let index = 0; index < 1_000; index += 1) {
    await submit({ from: 'stale', live: false, id: `stale-${index}`, setCookie: cookie(0), ms });
  }
  assert.equal(await answered('bounded-0', 'submission-0002', ms), cookie(0));
  for (let index = 1; index <= 1_000; index += 1) {
    await submit({ from: `bounded-${index}`, id: 'submission-0002', setCookie: cookie(index), ms });
  }
  assert.equal(await answered('bounded-0', 'submission-0002', ms), undefined);
  assert.equal(await answered('bounded-1', 'submission-0002', ms), cookie(1));
  assert.equal(await answered('bounded-1000', 'submission-0002', ms), cookie(1_000));
});
