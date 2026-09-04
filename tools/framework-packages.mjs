import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const frameworkPackages = [
  {
    packageName: '@webstir-io/module-contract',
    canonicalDir: 'packages/contracts/module-contract',
  },
  {
    packageName: '@webstir-io/testing-contract',
    canonicalDir: 'packages/contracts/testing-contract',
  },
  {
    packageName: '@webstir-io/webstir-backend',
    canonicalDir: 'packages/tooling/webstir-backend',
  },
  {
    packageName: '@webstir-io/webstir-frontend',
    canonicalDir: 'packages/tooling/webstir-frontend',
  },
  {
    packageName: '@webstir-io/webstir-testing',
    canonicalDir: 'packages/tooling/webstir-testing',
  },
  {
    packageName: '@webstir-io/webstir',
    canonicalDir: 'orchestrators/bun',
    releaseBuildScript: 'build:self',
  },
];

export const releaseGroups = [
  {
    name: 'webstir',
    installPackage: '@webstir-io/webstir',
    packageNames: [
      '@webstir-io/module-contract',
      '@webstir-io/webstir-backend',
      '@webstir-io/webstir-frontend',
      '@webstir-io/webstir',
    ],
  },
  {
    name: 'testing',
    installPackage: '@webstir-io/webstir-testing',
    packageNames: ['@webstir-io/testing-contract', '@webstir-io/webstir-testing'],
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

export function getReleaseGroupByName(groupName) {
  return releaseGroups.find((group) => group.name === groupName) ?? null;
}

export function parseReleaseSetTag(tagName) {
  for (const group of releaseGroups) {
    const prefix = `release-set/${group.name}/v`;
    if (!tagName.startsWith(prefix)) {
      continue;
    }

    const version = tagName.slice(prefix.length);
    if (/^\d+\.\d+\.\d+$/.test(version)) {
      return { group, version };
    }
  }

  return null;
}

export function getReleaseSetTag(group, version) {
  return `release-set/${group.name}/v${version}`;
}
