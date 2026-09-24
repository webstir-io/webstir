import { assert, test } from '@webstir-io/webstir-testing';
import { getBackendTestContext } from '@webstir-io/webstir-backend/testing';

test('notes create and validate through native HTML forms', async () => {
  const context = getBackendTestContext();
  if (!context) throw new Error('Run through webstir test --runtime backend.');
  const initial = await context.request('/api/notes');
  assert.equal(initial.status, 200);
  const cookie = initial.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Expected the form session cookie.');
  let html = await initial.text();
  const post = (body: Record<string, string>) => context.request('/api/notes', {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body), redirect: 'manual',
  });
  const invalid = await post({ _csrf: token(html), title: ' ', body: 'Keep this draft' });
  assert.equal(invalid.status, 422);
  html = await invalid.text();
  assert.isTrue(html.includes('Title must contain 1–120 characters.'));
  assert.isTrue(html.includes('Keep this draft'));

  const marker = `Recipe check ${Date.now()}`;
  const created = await post({ _csrf: token(html), title: marker, body: '<img src=x onerror=alert(1)>' });
  assert.equal(created.status, 303);
  assert.equal(created.headers.get('location'), '/api/notes');
  const list = await context.request('/api/notes', { headers: { cookie } });
  html = await list.text();
  assert.isTrue(html.includes(marker));
  assert.isTrue(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(html.includes('<img'), false);

  const rejected = await post({ _csrf: 'invalid', title: `Blocked ${marker}`, body: '' });
  assert.equal(rejected.status, 403);
  const after = await context.request('/api/notes', { headers: { cookie } });
  // Check rendered records, not the preserved draft in the form.
  const records = (await after.text()).match(/<article[\s\S]*?<\/article>/g) ?? [];
  assert.equal(records.some((record) => record.includes(`Blocked ${marker}`)), false);
});

function token(html: string): string {
  const value = html.match(/name="_csrf" value="([^"]+)"/)?.[1];
  if (!value) throw new Error('Expected a CSRF token in the rendered form.');
  return value;
}
