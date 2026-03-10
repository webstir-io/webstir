import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const frameworkPackages = [
  {
    releaseTag: 'module-contract',
    packageName: '@webstir-io/module-contract',
    canonicalDir: 'packages/contracts/module-contract',
  },
  {
    releaseTag: 'testing-contract',
    packageName: '@webstir-io/testing-contract',
    canonicalDir: 'packages/contracts/testing-contract',
  },
  {
    releaseTag: 'webstir-backend',
    packageName: '@webstir-io/webstir-backend',
    canonicalDir: 'packages/tooling/webstir-backend',
  },
  {
    releaseTag: 'webstir-frontend',
    packageName: '@webstir-io/webstir-frontend',
    canonicalDir: 'packages/tooling/webstir-frontend',
  },
  {
    releaseTag: 'webstir-testing',
    packageName: '@webstir-io/webstir-testing',
    canonicalDir: 'packages/tooling/webstir-testing',
  },
  {
    releaseTag: 'webstir',
    packageName: '@webstir-io/webstir',
    canonicalDir: 'orchestrators/bun',
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
