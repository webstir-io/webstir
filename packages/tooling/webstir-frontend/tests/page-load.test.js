import { expect, test } from 'bun:test';
import { preparePage, createPageLifecycle } from '../dist/runtime/index.js';

test('prepared data is delivered to setup without changing setup lifetime', async () => {
  const controller = new AbortController();
  const value = { name: 'Ready' };
  const setup = ({ data, url }) => {
    expect(data).toBe(value);
    expect(url.pathname).toBe('/next');
  };
  const prepared = await preparePage(
    Promise.resolve({
      setup,
      load: ({ signal, url }) => {
        expect(signal).toBe(controller.signal);
        expect(url.search).toBe('?q=1');
        return value;
      },
    }),
    'https://example.test/next?q=1',
    controller.signal,
  );
  const lifecycle = createPageLifecycle();
  lifecycle.start(prepared.module.setup, {}, 'https://example.test/next', prepared.data);
  await lifecycle.dispose();
});

test('superseding an uncooperative loader or import settles immediately', async () => {
  for (const importing of [true, false]) {
    const controller = new AbortController();
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const module = importing ? pending : Promise.resolve({ load: () => pending });
    const prepared = preparePage(module, 'https://example.test/', controller.signal);
    controller.abort();
    await expect(prepared).rejects.toThrow();
    release(
      importing
        ? {
            load: () => {
              throw new Error('must not execute');
            },
          }
        : 'obsolete',
    );
  }
});

test('load failures propagate and an explicitly marked page requires a loader', async () => {
  const signal = new AbortController().signal;
  await expect(
    preparePage(
      Promise.resolve({
        load: () => {
          throw new Error('failed');
        },
      }),
      'https://example.test/',
      signal,
    ),
  ).rejects.toThrow('failed');
  await expect(preparePage(Promise.resolve({}), 'https://example.test/', signal)).rejects.toThrow(
    'must export load',
  );
});
