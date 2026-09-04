import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { compileTestModules } from '../src/compile-tests.ts';

test('test compilation preserves ESM imports and rewrites TypeScript extensions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-compile-tests-'));
  const sourcePath = path.join(root, 'example.ts');
  const compiledPath = path.join(root, 'build', 'backend', 'example.js');
  try {
    await writeFile(
      sourcePath,
      `import type { Missing } from './types.ts';
import { value } from './helper.ts';
import { test, assert } from '@webstir-io/webstir-testing';
const answer: number = 42;
test('answer', () => assert.equal(value, answer));
`,
    );
    await compileTestModules(root, [
      { id: 'example', runtime: 'backend', sourcePath, compiledPath },
    ]);
    const output = await readFile(compiledPath, 'utf8');
    expect(output).not.toContain('Missing');
    expect(output).not.toContain(': number');
    expect(output).toMatch(/from ['"]\.\/helper\.js['"]/);
    expect(output).toContain("from '../.webstir/testing-runtime.mjs'");
    expect(output).toContain('const answer = 42');
    expect(
      await readFile(path.join(root, 'build', '.webstir', 'testing-runtime.mjs'), 'utf8'),
    ).toContain('export { test, assert }');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
