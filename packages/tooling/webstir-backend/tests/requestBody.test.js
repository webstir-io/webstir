import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { RequestBodyTooLargeError } from '../dist/runtime/core.js';
import { readRequestBody } from '../dist/runtime/request-body.js';

const LIMIT = 1024 * 1024;

function post(body, headers = {}) {
  return new Request('http://localhost/versions/', { method: 'POST', body, headers });
}

test('urlencoded bodies keep every value of a repeated field', async () => {
  const body = await readRequestBody(
    post('title=Q1+plan&addresses=t1&addresses=t2', {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    }),
    LIMIT,
  );
  assert.deepEqual(body, { title: 'Q1 plan', addresses: ['t1', 't2'] });
});

test('multipart bodies carry text fields and files', async () => {
  const form = new FormData();
  form.append('title', 'Q1 plan');
  form.append('addresses', 't1');
  form.append('addresses', 't2');
  form.append(
    'document',
    new File(['{"summary":"hi"}'], 'proposal.json', { type: 'application/json' }),
  );
  form.append('empty', new File([], ''));

  const body = await readRequestBody(post(form), LIMIT);
  assert.equal(body.title, 'Q1 plan');
  assert.deepEqual(body.addresses, ['t1', 't2']);
  assert.ok(body.document instanceof File);
  assert.equal(body.document.name, 'proposal.json');
  assert.match(body.document.type, /^application\/json/);
  assert.equal(await body.document.text(), '{"summary":"hi"}');
  assert.equal('empty' in body, false, 'an empty file input is left out');
});

test('bodies over the limit fail whether or not they declare a length', async () => {
  const big = 'x'.repeat(64);
  await assert.rejects(
    readRequestBody(post(big, { 'content-type': 'text/plain' }), 32),
    RequestBodyTooLargeError,
  );

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(big));
      controller.enqueue(new TextEncoder().encode(big));
      controller.close();
    },
  });
  const chunked = new Request('http://localhost/', {
    method: 'POST',
    body: stream,
    headers: { 'content-type': 'text/plain' },
    duplex: 'half',
  });
  await assert.rejects(readRequestBody(chunked, 100), RequestBodyTooLargeError);
});

test('json, text and empty bodies keep their existing behavior', async () => {
  assert.deepEqual(
    await readRequestBody(post('{"a":1}', { 'content-type': 'application/json' }), LIMIT),
    { a: 1 },
  );
  assert.equal(
    await readRequestBody(post('{broken', { 'content-type': 'application/json' }), LIMIT),
    undefined,
  );
  assert.equal(
    await readRequestBody(post('hello', { 'content-type': 'text/plain' }), LIMIT),
    'hello',
  );
  assert.equal(await readRequestBody(post(''), LIMIT), undefined);
  assert.equal(
    await readRequestBody(new Request('http://localhost/', { method: 'GET' }), LIMIT),
    undefined,
  );
});
