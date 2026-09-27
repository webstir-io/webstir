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

// start settles once the page's setup has finished, whatever shape the setup takes, so client-nav
// can mark the page ready only after its script has run; a failing setup is reported, not thrown.
const later = () => new Promise((resolve) => setTimeout(resolve, 10));
const setupShapes = [
  [
    'returns nothing',
    (done) => {
      done();
    },
  ],
  [
    'returns a cleanup',
    (done) => {
      done();
      return () => {};
    },
  ],
  [
    'resolves later',
    async (done) => {
      await later();
      done();
    },
  ],
  [
    'rejects later',
    async (done) => {
      await later();
      done();
      throw new Error('late');
    },
  ],
  [
    'throws',
    (done) => {
      done();
      throw new Error('now');
    },
  ],
];

for (const [shape, setup] of setupShapes) {
  test(`start settles after a setup that ${shape}`, async () => {
    const events = [];
    const lifecycle = createPageLifecycle(() => events.push('reported'));
    await lifecycle.start(() => setup(() => events.push('done')), {}, 'https://example.test/');
    events.push('settled');
    expect(events.filter((event) => event !== 'reported')).toEqual(['done', 'settled']);
    await lifecycle.dispose();
  });
}
