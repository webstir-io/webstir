import { test } from 'bun:test';
import assert from 'node:assert/strict';

import {
  createFormState,
  ensureSessionCsrfToken,
  formErrors,
  processFormSubmission,
  readFormState,
} from '../dist/runtime/forms.js';

const invalidName = () => [{ field: 'name', message: 'Too short.' }];

test('formErrors keeps the first message per field and puts fieldless issues under form', () => {
  assert.deepEqual(
    formErrors([
      { field: 'name', message: 'Too short.' },
      { field: 'name', message: 'Also wrong.' },
      { message: 'Try again.' },
      { field: 'slug', message: '' },
    ]),
    { name: 'Too short.', form: 'Try again.' },
  );
});

test('createFormState reports whether anything was submitted', () => {
  assert.deepEqual(createFormState(undefined, undefined), {
    submitted: false,
    values: {},
    issues: [],
    errors: {},
  });
  assert.equal(createFormState({ name: 'N' }, []).submitted, true);
});

test('a rerender failure answers 422 and leaves nothing in the session', () => {
  const session = {};
  const result = processFormSubmission({
    session,
    body: { name: 'N' },
    formId: 'createClient',
    rerender: { view: 'clientsPage', params: { slug: 'acme' } },
    validate: invalidName,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.result, {
    status: 422,
    rerender: {
      view: 'clientsPage',
      params: { slug: 'acme' },
      form: {
        id: 'createClient',
        values: { name: 'N' },
        issues: [{ field: 'name', message: 'Too short.', code: 'validation' }],
      },
    },
  });
  assert.equal(readFormState(result.session, 'createClient').submitted, false);
});

test('a csrf failure rerenders with 403 and the session token is accepted', () => {
  const { session, token } = ensureSessionCsrfToken(null);
  const forged = processFormSubmission({
    session,
    body: { _csrf: 'forged' },
    formId: 'createClient',
    csrf: true,
    rerender: 'clientsPage',
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.result.status, 403);
  assert.equal(forged.result.rerender.form.issues[0].code, 'csrf');

  const accepted = processFormSubmission({
    session,
    body: { _csrf: token, name: 'Acme' },
    formId: 'createClient',
    csrf: true,
    rerender: 'clientsPage',
  });
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.values, { name: 'Acme' });
  assert.equal(ensureSessionCsrfToken(session).token, token, 'the session token is not consumed');
});

test('a redirect failure is read once by the next loader', () => {
  const result = processFormSubmission({
    session: {},
    body: { name: 'N' },
    formId: 'createClient',
    redirectTo: '/clients/',
    validate: invalidName,
  });
  assert.equal(result.result.status, 303);
  const state = readFormState(result.session, 'createClient');
  assert.deepEqual(state.values, { name: 'N' });
  assert.deepEqual(state.errors, { name: 'Too short.' });
  assert.equal(readFormState(result.session, 'createClient').submitted, false);
  assert.equal(readFormState(null, 'createClient').submitted, false);
});
