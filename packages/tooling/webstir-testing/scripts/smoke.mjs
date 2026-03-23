import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-testing-smoke-'));

  try {
    await seedWorkspace(workspaceRoot);
    await linkPackage(workspaceRoot);
    await runSmokeStep('runner', ['dist/cli.js', '--workspace', workspaceRoot], (result) => {
      assert.match(result.stdout, /"type":"summary"/);
      assert.match(result.stdout, /"passed":1/);
      assert.match(result.stdout, /"failed":0/);
    });
    await runSmokeStep(
      'add-cli',
      ['dist/add-cli.js', 'generated-smoke', '--workspace', workspaceRoot],
      async () => {
        const generated = path.join(workspaceRoot, 'src', 'tests', 'generated-smoke.test.ts');
        const source = await fs.readFile(generated, 'utf8');
        assert.match(source, /sample passes/);
      },
    );
    console.log('[smoke] webstir-testing CLI smoke passed');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function seedWorkspace(workspaceRoot) {
  await fs.mkdir(path.join(workspaceRoot, 'src', 'frontend', 'tests'), { recursive: true });
  await fs.mkdir(path.join(workspaceRoot, 'build', 'frontend', 'tests'), { recursive: true });
  await fs.writeFile(
    path.join(workspaceRoot, 'package.json'),
    JSON.stringify(
      {
        name: '@demo/webstir-testing-smoke',
        version: '0.0.0',
        type: 'module',
      },
      null,
      2,
    ),
  );

  const source = `import { test, assert } from '@webstir-io/webstir-testing';

test('smoke runner passes', () => {
  assert.equal(1 + 1, 2);
});
`;
  await fs.writeFile(path.join(workspaceRoot, 'src', 'frontend', 'tests', 'smoke.test.js'), source);
  await fs.writeFile(
    path.join(workspaceRoot, 'build', 'frontend', 'tests', 'smoke.test.js'),
    source,
  );
}

async function linkPackage(workspaceRoot) {
  const scopeRoot = path.join(workspaceRoot, 'node_modules', '@webstir-io');
  await fs.mkdir(scopeRoot, { recursive: true });
  await fs.symlink(packageRoot, path.join(scopeRoot, 'webstir-testing'), 'dir');
}

async function runSmokeStep(label, args, validate) {
  const result = spawnSync('bun', args, {
    cwd: packageRoot,
    env: process.env,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `[smoke:${label}] ${result.stderr}`);
  await validate(result);
}

void main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
