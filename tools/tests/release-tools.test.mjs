import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getEmbeddedStagePaths, getFrameworkPackageByPackageName } from '../framework-packages.mjs';

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

function runNodeWithEnv(relativeScript, args, cwd, env) {
  return spawnSync(process.execPath, [relativeScript, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function writeExecutable(root, name, content) {
  const binDir = path.join(root, 'bin');
  mkdirSync(binDir, { recursive: true });
  const filePath = path.join(binDir, name);
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
  return filePath;
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

test('resolve-release-package resolves package metadata by package name', () => {
  const result = runNode('tools/resolve-release-package.mjs', ['--package-name', '@webstir-io/webstir-backend'], repoRoot);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /package_dir=packages\/tooling\/webstir-backend/);
  assert.match(result.stdout, /package_name=@webstir-io\/webstir-backend/);
  assert.match(result.stdout, /release_tag=release\/webstir-backend\/v/);
});

test('resolve-release-package resolves orchestrator package metadata', () => {
  const result = runNode('tools/resolve-release-package.mjs', ['--package-name', '@webstir-io/webstir'], repoRoot);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /package_dir=orchestrators\/bun/);
  assert.match(result.stdout, /package_name=@webstir-io\/webstir/);
  assert.match(result.stdout, /release_tag=release\/webstir\/v/);
});

test('embedded release staging covers the full embedded snapshot directory', () => {
  const backendPackage = getFrameworkPackageByPackageName('@webstir-io/webstir-backend');
  assert.ok(backendPackage);
  assert.deepEqual(getEmbeddedStagePaths(backendPackage), ['orchestrators/dotnet/Framework/Backend']);

  const orchestratorPackage = getFrameworkPackageByPackageName('@webstir-io/webstir');
  assert.ok(orchestratorPackage);
  assert.deepEqual(getEmbeddedStagePaths(orchestratorPackage), []);
});

test('release-package stages the full embedded snapshot directory', () => {
  withTempWorkspace((tempRoot) => {
    copyTree('tools', tempRoot);
    copyTree('packages/tooling/webstir-backend', tempRoot);
    copyTree('orchestrators/dotnet/Framework/Backend', tempRoot);

    const fakeToolLog = path.join(tempRoot, 'fake-tools.log');
    writeExecutable(
      tempRoot,
      'git',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\\n' "$*" >> "$FAKE_TOOL_LOG"
if [[ "$1" == "diff" ]]; then
  exit 0
fi
exit 0
`
    );
    writeExecutable(
      tempRoot,
      'bun',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'bun %s\\n' "$*" >> "$FAKE_TOOL_LOG"
exit 0
`
    );
    writeExecutable(
      tempRoot,
      'npm',
      `#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\\n' "$*" >> "$FAKE_TOOL_LOG"
if [[ "$1" == "version" ]]; then
  node -e 'const fs = require("node:fs"); const file = process.argv[1]; const version = process.argv[2]; const pkg = JSON.parse(fs.readFileSync(file, "utf8")); pkg.version = version; fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\\n");' package.json "$2"
fi
exit 0
`
    );

    const result = runNodeWithEnv(
      'tools/release-package.mjs',
      ['1.2.3', '--no-push', '--package-dir', 'packages/tooling/webstir-backend'],
      tempRoot,
      {
        FAKE_TOOL_LOG: fakeToolLog,
        PATH: `${path.join(tempRoot, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /› node tools\/sync-framework-embedded\.mjs/);

    const toolLog = readFileSync(fakeToolLog, 'utf8');
    assert.match(
      toolLog,
      /git add packages\/tooling\/webstir-backend\/package\.json orchestrators\/dotnet\/Framework\/Backend/
    );
    assert.doesNotMatch(toolLog, /git push/);
  });
});

test('publishable package manifests use concrete internal dependency ranges', () => {
  const cases = [
    {
      packageJsonPath: 'packages/tooling/webstir-backend/package.json',
      dependencyName: '@webstir-io/module-contract',
      expectedRange: '^0.1.14',
    },
    {
      packageJsonPath: 'packages/tooling/webstir-frontend/package.json',
      dependencyName: '@webstir-io/module-contract',
      expectedRange: '^0.1.14',
    },
    {
      packageJsonPath: 'packages/tooling/webstir-testing/package.json',
      dependencyName: '@webstir-io/testing-contract',
      expectedRange: '^0.1.7',
    },
    {
      packageJsonPath: 'orchestrators/bun/package.json',
      dependencyName: '@webstir-io/module-contract',
      expectedRange: '^0.1.15',
    },
  ];

  for (const { packageJsonPath, dependencyName, expectedRange } of cases) {
    const packageJson = readJson(packageJsonPath);

    assert.equal(packageJson.dependencies?.[dependencyName], expectedRange);
    assert.doesNotMatch(packageJson.dependencies?.[dependencyName] ?? '', /^workspace:/);
  }
});

test('packed publishable tooling packages do not ship workspace protocol dependencies', () => {
  withTempWorkspace((tempRoot) => {
    const cases = [
      {
        packageDir: 'packages/tooling/webstir-backend',
        dependencyName: '@webstir-io/module-contract',
        expectedRange: '^0.1.14',
      },
      {
        packageDir: 'packages/tooling/webstir-frontend',
        dependencyName: '@webstir-io/module-contract',
        expectedRange: '^0.1.14',
      },
      {
        packageDir: 'packages/tooling/webstir-testing',
        dependencyName: '@webstir-io/testing-contract',
        expectedRange: '^0.1.7',
      },
    ];

    for (const { packageDir, dependencyName, expectedRange } of cases) {
      copyTree(packageDir, tempRoot);

      const copiedPackageDir = path.join(tempRoot, packageDir);
      const packResult = run('npm', ['pack', '--ignore-scripts', '--json'], copiedPackageDir);
      assert.equal(packResult.status, 0, packResult.stderr);

      const [{ filename }] = JSON.parse(packResult.stdout);
      const tarballPath = path.join(copiedPackageDir, filename);
      const packedManifestResult = run('tar', ['-xOf', path.join(copiedPackageDir, filename), 'package/package.json'], copiedPackageDir);
      assert.equal(packedManifestResult.status, 0, packedManifestResult.stderr);

      const packedManifest = JSON.parse(packedManifestResult.stdout);
      assert.equal(packedManifest.dependencies?.[dependencyName], expectedRange);
      assert.doesNotMatch(packedManifest.dependencies?.[dependencyName] ?? '', /^workspace:/);

      const tarListResult = run('tar', ['-tf', tarballPath], copiedPackageDir);
      assert.equal(tarListResult.status, 0, tarListResult.stderr);
      assert.doesNotMatch(tarListResult.stdout, /package\/package-lock\.json/);
    }
  });
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

test('sync-framework-embedded check passes after syncing a clean managed package snapshot', () => {
  withTempWorkspace((tempRoot) => {
    copyTree('tools', tempRoot);
    copyTree('packages/tooling/webstir-backend', tempRoot);
    copyTree('orchestrators/dotnet/Framework/Backend', tempRoot);

    const syncResult = runNode(
      'tools/sync-framework-embedded.mjs',
      ['--package-dir', 'packages/tooling/webstir-backend'],
      tempRoot,
    );

    assert.equal(syncResult.status, 0);

    const result = runNode(
      'tools/sync-framework-embedded.mjs',
      ['--check', '--package-dir', 'packages/tooling/webstir-backend'],
      tempRoot,
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /already match canonical sources/);
  });
});
