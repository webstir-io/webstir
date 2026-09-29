import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { formStateSchema, formView, withShellData } from '@webstir-io/module-contract';

import { createFormState, readFormValues } from '../dist/runtime/forms.js';

// A fresh form shows its defaults; one that came back shows what was typed, and its errors.
for (const [name, state, expected] of [
  [
    'a fresh form',
    createFormState(undefined, undefined),
    { submitted: false, values: { title: 'Untitled' }, errors: {} },
  ],
  [
    'a form that came back',
    createFormState({ title: '', body: 'hi' }, [
      { field: 'title', message: 'Give it a title.' },
      { field: 'title', message: 'Second message.' },
      { message: 'Nothing was saved.' },
    ]),
    {
      submitted: true,
      values: { title: '', body: 'hi' },
      errors: { title: 'Give it a title.', form: 'Nothing was saved.' },
    },
  ],
]) {
  test(`formView binds ${name}`, () => {
    const view = formView(state, ['title', 'body'], { title: 'Untitled' });
    assert.deepEqual(view, expected);
    assert.equal(formStateSchema(['title', 'body']).safeParse(view).success, true);
  });
}

test('withShellData puts the shell beside the page data, checked against its schema', () => {
  const schema = {
    safeParse: (value) =>
      value && typeof value.account === 'string'
        ? { success: true, data: value }
        : { success: false, error: { issues: [{ path: ['account'], message: 'Required' }] } },
  };
  assert.deepEqual(withShellData({ title: 'Home' }, schema, { account: 'ada' }), {
    ok: true,
    data: { title: 'Home', shell: { account: 'ada' } },
  });
  const failed = withShellData({ title: 'Home' }, schema, {});
  assert.equal(failed.ok, false);
  assert.match(failed.error, /account/);
});

// A page cannot hand a file back, but a failed form can say which file to choose again.
test('form values keep a posted file by its name, and an empty file input as empty', () => {
  assert.deepEqual(
    readFormValues({
      _csrf: 'token',
      title: 'v3',
      document: new File(['{}'], 'v3.json'),
      none: new File([], ''),
      several: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')],
    }),
    { title: 'v3', document: 'v3.json', none: '', several: ['a.txt', 'b.txt'] },
  );
});
