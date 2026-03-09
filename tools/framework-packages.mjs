import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const publicManifestFields = [
  'name',
  'version',
  'description',
  'type',
  'main',
  'types',
  'exports',
  'bin',
  'keywords',
  'author',
  'license',
  'homepage',
  'bugs',
  'engines',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'publishConfig',
];

export const frameworkPackages = [
  {
    releaseTag: 'module-contract',
    packageName: '@webstir-io/module-contract',
    canonicalDir: 'packages/contracts/module-contract',
    embeddedDir: 'orchestrators/dotnet/Framework/Contracts/module-contract',
    embeddedHelpers: [
      {
        relativePath: 'scripts/publish.sh',
        kind: 'publish',
        canonicalTarget: 'packages/contracts/module-contract',
      },
    ],
  },
  {
    releaseTag: 'testing-contract',
    packageName: '@webstir-io/testing-contract',
    canonicalDir: 'packages/contracts/testing-contract',
    embeddedDir: 'orchestrators/dotnet/Framework/Contracts/testing-contract',
    embeddedHelpers: [],
  },
  {
    releaseTag: 'webstir-backend',
    packageName: '@webstir-io/webstir-backend',
    canonicalDir: 'packages/tooling/webstir-backend',
    embeddedDir: 'orchestrators/dotnet/Framework/Backend',
    embeddedHelpers: [
      {
        relativePath: 'scripts/publish.sh',
        kind: 'publish',
        canonicalTarget: 'packages/tooling/webstir-backend',
      },
      {
        relativePath: 'scripts/update-contract.sh',
        kind: 'update-contract',
        dependencyName: '@webstir-io/module-contract',
        canonicalTarget: 'packages/tooling/webstir-backend/scripts/update-contract.sh',
      },
    ],
  },
  {
    releaseTag: 'webstir-frontend',
    packageName: '@webstir-io/webstir-frontend',
    canonicalDir: 'packages/tooling/webstir-frontend',
    embeddedDir: 'orchestrators/dotnet/Framework/Frontend',
    embeddedHelpers: [
      {
        relativePath: 'scripts/publish.sh',
        kind: 'publish',
        canonicalTarget: 'packages/tooling/webstir-frontend',
      },
    ],
  },
  {
    releaseTag: 'webstir-testing',
    packageName: '@webstir-io/webstir-testing',
    canonicalDir: 'packages/tooling/webstir-testing',
    embeddedDir: 'orchestrators/dotnet/Framework/Testing',
    embeddedHelpers: [],
  },
  {
    releaseTag: 'webstir',
    packageName: '@webstir-io/webstir',
    canonicalDir: 'orchestrators/bun',
    embeddedDir: null,
    embeddedHelpers: [],
  },
];

export function getRepoRoot(metaUrl) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), '..');
}

export function normalizeRelativePath(relativePath) {
  return relativePath.replaceAll(path.sep, '/').replace(/^\.\//, '').replace(/\/$/, '');
}

export function getFrameworkPackageByCanonicalDir(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  return frameworkPackages.find((pkg) => pkg.canonicalDir === normalizedPath) ?? null;
}

export function getFrameworkPackageByPackageName(packageName) {
  return frameworkPackages.find((pkg) => pkg.packageName === packageName) ?? null;
}

export function getFrameworkPackageByEmbeddedDir(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  return frameworkPackages.find((pkg) => pkg.embeddedDir && pkg.embeddedDir === normalizedPath) ?? null;
}

export function hasEmbeddedSnapshot(pkg) {
  return typeof pkg.embeddedDir === 'string' && pkg.embeddedDir.length > 0;
}

export function parseFrameworkReleaseTag(tagName) {
  for (const pkg of frameworkPackages) {
    const prefix = `release/${pkg.releaseTag}/v`;
    if (!tagName.startsWith(prefix)) {
      continue;
    }

    const version = tagName.slice(prefix.length);
    if (/^\d+\.\d+\.\d+$/.test(version)) {
      return { package: pkg, version };
    }
  }

  return null;
}

export function getFrameworkReleaseTag(pkg, version) {
  return `release/${pkg.releaseTag}/v${version}`;
}

export function getEmbeddedManagedPaths(pkg) {
  if (!hasEmbeddedSnapshot(pkg)) {
    return [];
  }

  return [
    `${pkg.embeddedDir}/package.json`,
    ...pkg.embeddedHelpers.map((helper) => `${pkg.embeddedDir}/${helper.relativePath}`),
  ];
}

export function isManagedEmbeddedContentPath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  return normalizedPath === '.editorconfig'
    || normalizedPath === '.gitignore'
    || normalizedPath === 'README.md'
    || normalizedPath === 'LICENSE'
    || normalizedPath.startsWith('src/')
    || normalizedPath.startsWith('tests/')
    || normalizedPath.startsWith('templates/')
    || normalizedPath.startsWith('schema/')
    || normalizedPath.startsWith('examples/')
    || /^tsconfig(\..+)?\.json$/u.test(normalizedPath)
    || normalizedPath === 'scripts/build-schema.mjs'
    || normalizedPath === 'scripts/smoke.mjs';
}

export function renderEmbeddedHelperScript(pkg, helper) {
  let actionMessage;
  if (helper.kind === 'publish') {
    actionMessage = `Run the canonical release helper from ${helper.canonicalTarget} instead.`;
  } else if (helper.kind === 'update-contract') {
    actionMessage = `Update ${helper.dependencyName} from ${helper.canonicalTarget} instead.`;
  } else {
    throw new Error(`Unsupported embedded helper kind "${helper.kind}" for ${pkg.packageName}.`);
  }

  return `#!/usr/bin/env bash

set -euo pipefail

cat >&2 <<'EOF'
error: this package is an embedded framework copy under orchestrators/dotnet/Framework/**.
${actionMessage}
EOF
exit 1
`;
}
