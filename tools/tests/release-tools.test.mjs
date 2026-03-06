import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function withTempWorkspace(setup) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'webstir-release-tools-'));
  try {
    return setup(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function copyTree(relativePath, tempRoot) {
  const source = path.join(repoRoot, relativePath);
  const target = path.join(tempRoot, relativePath);
  cpSync(source, target, { recursive: true });
}

function runNode(relativeScript, args, cwd) {
  return spawnSync(process.execPath, [relativeScript, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('resolve-release-package rejects mismatched tag versions', () => {
  withTempWorkspace((tempRoot) => {
    copyTree('tools', tempRoot);
    copyTree('packages/contracts/module-contract', tempRoot);

    const result = runNode('tools/resolve-release-package.mjs', ['--tag', 'release/module-contract/v9.9.9'], tempRoot);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /tag version 9\.9\.9 does not match/i);
  });
});

test('resolve-release-package resolves canonical package metadata', () => {
  const result = runNode('tools/resolve-release-package.mjs', ['--package-dir', 'packages/tooling/webstir-backend'], repoRoot);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /package_dir=packages\/tooling\/webstir-backend/);
  assert.match(result.stdout, /package_name=@webstir-io\/webstir-backend/);
  assert.match(result.stdout, /release_tag=release\/webstir-backend\/v/);
});

test('sync-framework-embedded check fails when a managed helper stub is stale', () => {
  withTempWorkspace((tempRoot) => {
    copyTree('tools', tempRoot);
    copyTree('packages/tooling/webstir-backend', tempRoot);
    copyTree('orchestrators/dotnet/Framework/Backend', tempRoot);

    writeFileSync(
      path.join(tempRoot, 'orchestrators/dotnet/Framework/Backend/scripts/update-contract.sh'),
      '# stale\n',
    );

    const result = runNode(
      'tools/sync-framework-embedded.mjs',
      ['--check', '--package-dir', 'packages/tooling/webstir-backend'],
      tempRoot,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Embedded framework package snapshots are stale/);
    assert.match(result.stderr, /Backend\/scripts\/update-contract\.sh/);
  });
});

test('sync-framework-embedded check fails when a managed embedded source file is stale', () => {
  withTempWorkspace((tempRoot) => {
    copyTree('tools', tempRoot);
    copyTree('packages/tooling/webstir-backend', tempRoot);
    copyTree('orchestrators/dotnet/Framework/Backend', tempRoot);

    writeFileSync(
      path.join(tempRoot, 'orchestrators/dotnet/Framework/Backend/src/manifest/pipeline.ts'),
      '// stale\n',
    );

    const result = runNode(
      'tools/sync-framework-embedded.mjs',
      ['--check', '--package-dir', 'packages/tooling/webstir-backend'],
      tempRoot,
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Embedded framework package snapshots are stale/);
    assert.match(result.stderr, /Backend\/src\/manifest\/pipeline\.ts/);
  });
});

test('sync-framework-embedded restores missing canonical managed files into the embedded snapshot', () => {
  withTempWorkspace((tempRoot) => {
    copyTree('tools', tempRoot);
    copyTree('packages/tooling/webstir-backend', tempRoot);
    copyTree('orchestrators/dotnet/Framework/Backend', tempRoot);

    rmSync(
      path.join(tempRoot, 'orchestrators/dotnet/Framework/Backend/src/build/artifacts.ts'),
      { force: true },
    );

    const checkResult = runNode(
      'tools/sync-framework-embedded.mjs',
      ['--check', '--package-dir', 'packages/tooling/webstir-backend'],
      tempRoot,
    );

    assert.equal(checkResult.status, 1);
    assert.match(checkResult.stderr, /Backend\/src\/build\/artifacts\.ts/);

    const syncResult = runNode(
      'tools/sync-framework-embedded.mjs',
      ['--package-dir', 'packages/tooling/webstir-backend'],
      tempRoot,
    );

    assert.equal(syncResult.status, 0);
    assert.match(syncResult.stdout, /Backend\/src\/build\/artifacts\.ts/);
  });
});

test('sync-framework-embedded check passes for a clean managed package snapshot', () => {
  withTempWorkspace((tempRoot) => {
    copyTree('tools', tempRoot);
    copyTree('packages/tooling/webstir-backend', tempRoot);
    copyTree('orchestrators/dotnet/Framework/Backend', tempRoot);

    const result = runNode(
      'tools/sync-framework-embedded.mjs',
      ['--check', '--package-dir', 'packages/tooling/webstir-backend'],
      tempRoot,
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /already match canonical sources/);
  });
});
