import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('emits dist output', () => {
  assert.ok(fs.existsSync(new URL('../dist/index.js', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../dist/index.d.ts', import.meta.url)));
});

test('schema artifacts are valid JSON', () => {
  const runnerSchema = JSON.parse(
    fs.readFileSync(new URL('../schema/RunnerEvent.schema.json', import.meta.url), 'utf8')
  );
  const manifestSchema = JSON.parse(
    fs.readFileSync(new URL('../schema/TestManifest.schema.json', import.meta.url), 'utf8')
  );

  assert.equal(typeof runnerSchema, 'object');
  assert.equal(typeof manifestSchema, 'object');
  assert.ok(runnerSchema);
  assert.ok(manifestSchema);
});
