import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  frameworkPackages,
  getReleaseGroupByName,
  getReleaseSetTag,
  parseReleaseSetTag,
} from '../framework-packages.mjs';
import { prepareReleaseSet, resolveTargetVersion } from '../prepare-release-set.mjs';
import { classifyRegistryVersion, createReleasePlan } from '../release-set.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const textDecoder = new TextDecoder();

function withTempWorkspace(setup) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'webstir-release-tools-'));
  try {
    return setup(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function copyManifest(relativeDir, tempRoot) {
  const targetDir = path.join(tempRoot, relativeDir);
  mkdirSync(targetDir, { recursive: true });
  cpSync(path.join(repoRoot, relativeDir, 'package.json'), path.join(targetDir, 'package.json'));
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function run(command, args, cwd) {
  const result = Bun.spawnSync({
    cmd: [command, ...args],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });
  return {
    status: result.exitCode,
    stdout: textDecoder.decode(result.stdout),
    stderr: textDecoder.decode(result.stderr),
  };
}

test('release-set tags resolve only synchronized release groups', () => {
  const group = getReleaseGroupByName('webstir');

  assert.equal(getReleaseSetTag(group, '1.2.3'), 'release-set/webstir/v1.2.3');
  assert.equal(parseReleaseSetTag('release-set/webstir/v1.2.3')?.group.name, 'webstir');
  assert.equal(parseReleaseSetTag('release/webstir/v1.2.3'), null);
  assert.equal(parseReleaseSetTag('release-set/webstir/vnext'), null);
});

test('patch preparation advances from the highest current group version', () => {
  assert.equal(resolveTargetVersion('patch', ['0.1.18', '0.1.20', '0.1.51']), '0.1.52');
  assert.equal(resolveTargetVersion('minor', ['0.1.18', '0.1.51']), '0.2.0');
  assert.throws(() => resolveTargetVersion('0.1.51', ['0.1.18', '0.1.51']), /must be newer/i);
  assert.equal(resolveTargetVersion('0.2.0', ['0.2.0', '0.2.0']), '0.2.0');
});

test('prepare-release-set synchronizes production manifests and internal ranges', () => {
  withTempWorkspace((tempRoot) => {
    for (const packageName of getReleaseGroupByName('webstir').packageNames) {
      const frameworkPackage = frameworkPackages.find((entry) => entry.packageName === packageName);
      copyManifest(frameworkPackage.canonicalDir, tempRoot);
    }

    const result = prepareReleaseSet({
      repoRoot: tempRoot,
      groupName: 'webstir',
      versionSpec: '0.2.0',
    });

    assert.equal(result.targetVersion, '0.2.0');
    assert.equal(result.releaseTag, 'release-set/webstir/v0.2.0');
    assert.equal(result.changedFiles.length, 4);

    const backend = readJson(tempRoot, 'packages/tooling/webstir-backend/package.json');
    const frontend = readJson(tempRoot, 'packages/tooling/webstir-frontend/package.json');
    const webstir = readJson(tempRoot, 'orchestrators/bun/package.json');

    assert.equal(backend.version, '0.2.0');
    assert.equal(frontend.version, '0.2.0');
    assert.equal(webstir.version, '0.2.0');
    assert.equal(backend.dependencies['@webstir-io/module-contract'], '^0.2.0');
    assert.equal(frontend.dependencies['@webstir-io/module-contract'], '^0.2.0');
    assert.equal(webstir.dependencies['@webstir-io/module-contract'], '^0.2.0');
    assert.equal(webstir.dependencies['@webstir-io/webstir-backend'], '^0.2.0');
    assert.equal(webstir.dependencies['@webstir-io/webstir-frontend'], '^0.2.0');
  });
});

test('release plan builds the dependency closure once and publishes in dependency order', () => {
  withTempWorkspace((tempRoot) => {
    for (const frameworkPackage of frameworkPackages) {
      copyManifest(frameworkPackage.canonicalDir, tempRoot);
    }
    prepareReleaseSet({
      repoRoot: tempRoot,
      groupName: 'webstir',
      versionSpec: '0.2.0',
    });

    const plan = createReleasePlan({
      repoRoot: tempRoot,
      groupName: 'webstir',
      version: '0.2.0',
    });
    const buildNames = plan.buildPackages.map((entry) => entry.packageName);
    const publishNames = plan.publishPackages.map((entry) => entry.packageName);

    assert.deepEqual(publishNames, [
      '@webstir-io/module-contract',
      '@webstir-io/webstir-backend',
      '@webstir-io/webstir-frontend',
      '@webstir-io/webstir',
    ]);
    assert.equal(new Set(buildNames).size, buildNames.length);
    assert.ok(
      buildNames.indexOf('@webstir-io/testing-contract') <
        buildNames.indexOf('@webstir-io/webstir-testing'),
    );
    assert.ok(
      buildNames.indexOf('@webstir-io/webstir-testing') < buildNames.indexOf('@webstir-io/webstir'),
    );
  });
});

test('release plan rejects unsynchronized package versions before publication', () => {
  assert.throws(
    () => createReleasePlan({ groupName: 'webstir', version: '9.9.9' }),
    /run release:prepare/i,
  );
});

test('registry state distinguishes missing, partial, and complete publication', () => {
  assert.deepEqual(
    classifyRegistryVersion({
      exactStatus: 404,
      exactBody: null,
      packumentStatus: 200,
      packumentBody: { versions: {} },
      version: '1.2.3',
    }),
    { kind: 'missing' },
  );

  const partial = classifyRegistryVersion({
    exactStatus: 200,
    exactBody: { version: '1.2.3' },
    packumentStatus: 200,
    packumentBody: { versions: {} },
    version: '1.2.3',
  });
  assert.equal(partial.kind, 'partial');
  assert.match(partial.detail, /package index does not expose it/);

  const metadata = { version: '1.2.3', gitHead: 'abc' };
  assert.deepEqual(
    classifyRegistryVersion({
      exactStatus: 200,
      exactBody: metadata,
      packumentStatus: 200,
      packumentBody: { versions: { '1.2.3': metadata } },
      version: '1.2.3',
    }),
    { kind: 'published', metadata },
  );
});

test('release workflow delegates validation to exact-SHA CI', () => {
  const workflow = readFileSync(
    path.join(repoRoot, '.github/workflows/release-package.yml'),
    'utf8',
  );

  assert.match(workflow, /release-set\/\*\*/);
  assert.match(workflow, /Verify exact commit passed main CI/);
  assert.match(workflow, /bun tools\/release-set\.mjs\s+--publish/);
  assert.doesNotMatch(workflow, /--version "\$\{\{ inputs\.version \}\}"/);
  assert.match(workflow, /--version "\$\{RELEASE_VERSION\}"/);
  assert.doesNotMatch(workflow, /bun audit/);
  assert.doesNotMatch(workflow, /playwright install/);
  assert.doesNotMatch(workflow, /bun run (?:test|smoke)/);
});

test('publishable package manifests use concrete internal dependency ranges', () => {
  const cases = [
    {
      packageJsonPath: 'packages/tooling/webstir-backend/package.json',
      dependencyName: '@webstir-io/module-contract',
      expectedRange: '^0.1.52',
    },
    {
      packageJsonPath: 'packages/tooling/webstir-frontend/package.json',
      dependencyName: '@webstir-io/module-contract',
      expectedRange: '^0.1.52',
    },
    {
      packageJsonPath: 'packages/tooling/webstir-testing/package.json',
      dependencyName: '@webstir-io/testing-contract',
      expectedRange: '^0.1.8',
    },
    {
      packageJsonPath: 'orchestrators/bun/package.json',
      dependencyName: '@webstir-io/module-contract',
      expectedRange: '^0.1.52',
    },
  ];

  for (const { packageJsonPath, dependencyName, expectedRange } of cases) {
    const packageJson = readJson(repoRoot, packageJsonPath);

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
        expectedRange: '^0.1.52',
      },
      {
        packageDir: 'packages/tooling/webstir-frontend',
        dependencyName: '@webstir-io/module-contract',
        expectedRange: '^0.1.52',
      },
      {
        packageDir: 'packages/tooling/webstir-testing',
        dependencyName: '@webstir-io/testing-contract',
        expectedRange: '^0.1.8',
      },
    ];

    for (const { packageDir, dependencyName, expectedRange } of cases) {
      const copiedPackageDir = path.join(tempRoot, packageDir);
      cpSync(path.join(repoRoot, packageDir), copiedPackageDir, { recursive: true });

      const packResult = run(
        'bun',
        ['pm', 'pack', '--ignore-scripts', '--quiet'],
        copiedPackageDir,
      );
      assert.equal(packResult.status, 0, packResult.stderr);

      const filename = packResult.stdout.trim();
      const tarballPath = path.join(copiedPackageDir, filename);
      const packedManifestResult = run(
        'tar',
        ['-xOf', tarballPath, 'package/package.json'],
        copiedPackageDir,
      );
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
