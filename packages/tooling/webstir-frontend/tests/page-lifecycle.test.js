import { expect, test } from 'bun:test';
import { createPageLifecycle } from '../dist/runtime/index.js';

test('abort precedes reverse cleanup; slow setup does not hold navigation and late cleanup runs', async () => {
  const events = [];
  let finish;
  const lifecycle = createPageLifecycle();
  lifecycle.start(
    ({ signal, scope }) => {
      signal.addEventListener('abort', () => events.push('abort'));
      scope.add(() => events.push('first'));
      scope.add(() => events.push('last'));
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    {},
    'https://example.test/a',
  );
  await lifecycle.dispose();
  lifecycle.start(
    () => {
      events.push('next');
    },
    {},
    'https://example.test/b',
  );
  finish(() => events.push('late'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events).toEqual(['abort', 'last', 'first', 'next', 'late']);
  await lifecycle.dispose();
});

test('cleanup failure does not skip remaining resources; setup errors are reported', async () => {
  const errors = [];
  const events = [];
  const lifecycle = createPageLifecycle((error) => errors.push(error));
  lifecycle.start(
    ({ scope }) => {
      scope.add(() => events.push('released'));
      scope.add(() => {
        throw new Error('cleanup');
      });
      throw new Error('setup');
    },
    {},
    'https://example.test/',
  );
  await expect(lifecycle.dispose()).rejects.toThrow('cleanup');
  expect(events).toEqual(['released']);
  expect(errors[0].message).toBe('setup');
  await lifecycle.dispose();
});

test('a synchronous returned cleanup is awaited before disposal finishes', async () => {
  const events = [];
  const lifecycle = createPageLifecycle();
  lifecycle.start(
    () => async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push('cleaned');
    },
    {},
    'https://example.test/',
  );
  await lifecycle.dispose();
  events.push('disposed');
  expect(events).toEqual(['cleaned', 'disposed']);
});
