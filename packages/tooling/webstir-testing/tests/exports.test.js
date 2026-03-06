import test from 'node:test';
import assert from 'node:assert/strict';

test('exports runtime helpers', async () => {
  const module = await import('../dist/index.js');
  assert.equal(typeof module.test, 'function');
  assert.equal(typeof module.run, 'function');
  assert.equal(typeof module.discoverTestManifest, 'function');
  assert.equal(typeof module.createDefaultProviderRegistry, 'function');
});

test('exports assertions', async () => {
  const module = await import('../dist/index.js');
  assert.equal(typeof module.assert, 'object');
  assert.ok(module.assert);
  assert.equal(typeof module.equal, 'function');
  assert.equal(typeof module.isTrue, 'function');
  assert.equal(typeof module.fail, 'function');
});
