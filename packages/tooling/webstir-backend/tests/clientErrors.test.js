import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  CLIENT_ERROR_MAX_BYTES,
  formatClientErrorReport,
  isClientErrorsPath,
  readClientErrorReport,
  renderField,
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

test('the route accepts an optional trailing slash and nothing else', () => {
  assert.equal(isClientErrorsPath('/client-errors'), true);
  assert.equal(isClientErrorsPath('/client-errors/'), true);
  assert.equal(isClientErrorsPath('/api/client-errors'), false);
  assert.equal(isClientErrorsPath('/client-errors/x'), false);
});

test('terminal output escapes control characters from every field', async () => {
  const forged = 'boom\n[webstir] build succeeded\u001b[2J';
  const outcome = await readClientErrorReport(
    post(
      JSON.stringify({
        type: 'error\r',
        message: forged,
        filename: 'app\u0007.js',
        lineno: 1,
        colno: 1,
        stack: '\u001b[31mError: boom\u001b[0m\n    at run (app.js:1:1)',
        correlationId: 'c-1\u2028',
      }),
    ),
  );
  assert.equal(outcome.status, 204);
  // The structured report keeps the original values.
  assert.equal(outcome.report.message, forged);

  const line = formatClientErrorReport(outcome.report);
  assert.equal(
    line,
    'error\\r: boom\\n[webstir] build succeeded\\x1b[2J at app\\x07.js:1:1 (c-1\\u2028)\n  \\x1b[31mError: boom\\x1b[0m',
  );
  // The only raw newline is the one the formatter adds before the stack line.
  assert.equal(line.split('\n').length, 2);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting none remain
  assert.equal(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(line.replace('\n  ', '')), false);
});

test('rendered fields are cut to a sane length', () => {
  const rendered = renderField('x'.repeat(5_000));
  assert.equal(rendered.length, 1_001);
  assert.equal(rendered.endsWith('…'), true);
});
