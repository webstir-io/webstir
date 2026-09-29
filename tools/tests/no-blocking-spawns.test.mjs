import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Where `bun test` runs code: the tests and the helpers they import.
const TEST_ROOTS = [
  'orchestrators/bun/tests',
  'orchestrators/bun/test-support',
  'packages/contracts/module-contract/tests',
  'packages/contracts/testing-contract/tests',
  'packages/tooling/webstir-backend/tests',
  'packages/tooling/webstir-frontend/tests',
  'packages/tooling/webstir-testing/tests',
  'tools/tests',
];

const BLOCKING_SPAWN = /\b(?:Bun\.spawnSync|spawnSync|execSync|execFileSync)\s*\(/;

function* sourceFiles(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules' && name !== 'fixtures') yield* sourceFiles(full);
    } else if (/\.(?:[cm]?[jt]s)$/.test(name)) {
      yield full;
    }
  }
}

// A blocking spawn in a bun test worker has waited forever in CI for a child that had already
// exited, stalling the whole gate until its watchdog. Tests spawn without blocking instead
// (orchestrators/bun/test-support/cli.ts has runCommand and runWebstir).
test('no test or test helper spawns a process in a way that blocks its worker', () => {
  const offenders = [];
  for (const root of TEST_ROOTS) {
    for (const file of sourceFiles(path.join(repoRoot, root))) {
      if (file === fileURLToPath(import.meta.url)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (BLOCKING_SPAWN.test(line)) {
            offenders.push(`${path.relative(repoRoot, file)}:${index + 1}: ${line.trim()}`);
          }
        });
    }
  }
  assert.deepEqual(offenders, []);
});
