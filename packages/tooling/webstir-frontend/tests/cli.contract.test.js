import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('frontend cli is emitted with a Bun shebang', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.join(here, '..', 'dist', 'cli.js');
  const source = await fs.readFile(cliPath, 'utf8');

  assert.match(source, /^#!\/usr\/bin\/env bun/m);
});
