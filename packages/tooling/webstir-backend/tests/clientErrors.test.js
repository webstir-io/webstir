import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  CLIENT_ERROR_MAX_BYTES,
  formatClientErrorReport,
  isClientErrorsPath,
  readClientErrorReport,
} from '../dist/index.js';

function post(body, headers = {}) {
  return new Request('http://localhost/client-errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

test('client error reports are taken with 204 and normalized', async () => {
  const outcome = await readClientErrorReport(
    post(
      JSON.stringify({
        type: 'unhandledrejection',
        message: 'boom',
        stack: 'Error: boom\n    at run (app.js:1:1)',
        filename: 'app.js',
        lineno: 12,
        colno: 3.7,
        pageUrl: 'http://localhost/',
        userAgent: 'test',
        timestamp: '2026-09-13T00:00:00.000Z',
        correlationId: 'c-payload',
      }),
      { 'x-correlation-id': 'c-header' },
    ),
  );

  assert.equal(outcome.status, 204);
  assert.deepEqual(outcome.report, {
    type: 'unhandledrejection',
    message: 'boom',
    stack: 'Error: boom\n    at run (app.js:1:1)',
    filename: 'app.js',
    lineno: 12,
    colno: 3,
    pageUrl: 'http://localhost/',
    userAgent: 'test',
    timestamp: '2026-09-13T00:00:00.000Z',
    correlationId: 'c-payload',
  });
  assert.equal(
    formatClientErrorReport(outcome.report),
    'unhandledrejection: boom at app.js:12:3 (c-payload)\n  Error: boom',
  );
});

test('the correlation id falls back to the request header', async () => {
  const outcome = await readClientErrorReport(
    post(JSON.stringify({ message: 'boom' }), { 'x-correlation-id': ' c-header ' }),
  );
  assert.equal(outcome.status, 204);
  assert.equal(outcome.report?.correlationId, 'c-header');
  assert.equal(outcome.report?.type, 'error');
});

test('non-JSON content types are refused with 415', async () => {
  const outcome = await readClientErrorReport(post('boom', { 'content-type': 'text/plain' }));
  assert.equal(outcome.status, 415);
  assert.equal(outcome.report, null);

  const missing = new Request('http://localhost/client-errors', { method: 'POST', body: '{}' });
  missing.headers.delete('content-type');
  assert.equal((await readClientErrorReport(missing)).status, 415);
});

test('oversized reports are refused with 413, declared or streamed', async () => {
  const declared = await readClientErrorReport(
    post('{}', { 'content-length': String(CLIENT_ERROR_MAX_BYTES + 1) }),
  );
  assert.equal(declared.status, 413);

  const streamed = await readClientErrorReport(
    post(JSON.stringify({ message: 'x'.repeat(CLIENT_ERROR_MAX_BYTES) })),
  );
  assert.equal(streamed.status, 413);

  const justUnder = await readClientErrorReport(
    post(JSON.stringify({ message: 'x'.repeat(CLIENT_ERROR_MAX_BYTES - 64) })),
  );
  assert.equal(justUnder.status, 204);
});

test('unreadable bodies are taken quietly and dropped', async () => {
  for (const body of ['', 'not json', '[1,2]', '"text"']) {
    const outcome = await readClientErrorReport(post(body));
    assert.equal(outcome.status, 204, body);
    assert.equal(outcome.report, null, body);
  }
});

test('only the exact path is the client error route', () => {
  assert.equal(isClientErrorsPath('/client-errors'), true);
  assert.equal(isClientErrorsPath('/client-errors/'), false);
  assert.equal(isClientErrorsPath('/api/client-errors'), false);
});
