import { assert, test } from '@webstir-io/webstir-testing';

type Context = { request(path: string, init?: RequestInit): Promise<Response> };
function context(): Context {
  const store = globalThis as Record<string | symbol, unknown>;
  const value = store[Symbol.for('webstir.backendTestContext')] as Context | undefined;
  if (!value) throw new Error('Backend test context not available.');
  return value;
}
test('notes page offers an HTML sign-in form', async () => {
  const response = await context().request('/api/notes');
  assert.equal(response.status, 200);
  assert.isTrue((await response.text()).includes('action="/api/login"'));
});
test('notes reject anonymous creation', async () => {
  const response = await context().request('/api/notes/create', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'title=Unauthorized', redirect: 'manual',
  });
  assert.equal(response.status, 401);
});
test('sign-in rejects an incorrect password', async () => {
  const response = await context().request('/api/login', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=alice&password=incorrect', redirect: 'manual',
  });
  assert.equal(response.status, 401);
});
