import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  databaseCloseTimeoutMs,
  drainServer,
  finishedWithin,
  shutdownTimeoutMs,
} from '../dist/runtime/shutdown.js';

test('SHUTDOWN_TIMEOUT is in seconds, four by default, and anything else is the default', () => {
  for (const [value, ms] of [
    [undefined, 4000],
    ['', 4000],
    [' 10 ', 10_000],
    ['0.5', 500],
    ['0', 0],
    ['-1', 4000],
    ['soon', 4000],
    // A timer holds about 24.8 days at most; a longer wait is that long, not none.
    ['2147484', 2_147_483_647],
    ['1e12', 2_147_483_647],
  ]) {
    assert.equal(shutdownTimeoutMs({ SHUTDOWN_TIMEOUT: value }), ms, String(value));
  }
});

test('a server is given the limit to finish, and closed when it has not', async () => {
  const calls = [];
  const server = (ms) => ({
    stop(force) {
      calls.push(force === true ? 'force' : 'wait');
      return force ? Promise.resolve() : Bun.sleep(ms);
    },
  });
  assert.equal(await drainServer(server(10), 500), true);
  assert.deepEqual(calls.splice(0), ['wait']);
  assert.equal(await drainServer(server(2000), 50), false);
  assert.deepEqual(calls.splice(0), ['wait', 'force']);
  // A server whose stop answers nothing has nothing in flight to wait for.
  assert.equal(await drainServer({ stop: () => undefined }, 50), true);

  assert.equal(await finishedWithin(Bun.sleep(5), 200), true);
  assert.equal(await finishedWithin(Bun.sleep(500), 20), false);
});

test('a database gets ten seconds to close, or as long as the server waits for work', () => {
  assert.equal(databaseCloseTimeoutMs(0), 10_000);
  assert.equal(databaseCloseTimeoutMs(4000), 10_000);
  assert.equal(databaseCloseTimeoutMs(30_000), 30_000);
});
