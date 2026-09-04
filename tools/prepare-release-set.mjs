#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getFrameworkPackageByPackageName,
  getReleaseGroupByName,
  getReleaseSetTag,
  getRepoRoot,
} from './framework-packages.mjs';

const defaultRepoRoot = getRepoRoot(import.meta.url);
const internalDependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function fail(message) {
  throw new Error(message);
}

function usage() {
  console.error(`Usage: prepare-release-set.mjs <webstir|testing> <patch|minor|major|x.y.z>

Updates every package in a release group to one version and synchronizes internal dependency ranges.
It does not commit, tag, push, or publish.`);
  process.exit(1);
}

export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) {
    fail(`invalid semantic version "${value}"`);
  }

  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return 0;
}

export function resolveTargetVersion(versionSpec, currentVersions) {
  if (currentVersions.length === 0) {
    fail('release group has no packages');
  }

  const highestVersion = [...currentVersions].sort(compareVersions).at(-1);
  if (/^\d+\.\d+\.\d+$/.test(versionSpec)) {
    const alreadySynchronized = currentVersions.every((version) => version === versionSpec);
    if (!alreadySynchronized && compareVersions(versionSpec, highestVersion) <= 0) {
      fail(
        `target version ${versionSpec} must be newer than current group version ${highestVersion}`,
      );
    }
    return versionSpec;
  }

  const [major, minor, patch] = parseVersion(highestVersion);
  switch (versionSpec) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      fail(`invalid version bump "${versionSpec}"`);
  }
}

function readPackageJson(repoRoot, frameworkPackage) {
  const manifestPath = path.join(repoRoot, frameworkPackage.canonicalDir, 'package.json');
  return {
    manifestPath,
    manifest: JSON.parse(readFileSync(manifestPath, 'utf8')),
  };
}

export function prepareReleaseSet({
  repoRoot = defaultRepoRoot,
  groupName,
  versionSpec,
  write = true,
}) {
  const group = getReleaseGroupByName(groupName);
  if (!group) {
    fail(`unknown release group "${groupName}"`);
  }

  const packages = group.packageNames.map((packageName) => {
    const frameworkPackage = getFrameworkPackageByPackageName(packageName);
    if (!frameworkPackage) {
      fail(`release group ${group.name} references unknown package ${packageName}`);
    }
    return {
      frameworkPackage,
      ...readPackageJson(repoRoot, frameworkPackage),
    };
  });

  const targetVersion = resolveTargetVersion(
    versionSpec,
    packages.map(({ manifest }) => manifest.version),
  );
  const groupPackageNames = new Set(group.packageNames);
  const changedFiles = [];

  for (const entry of packages) {
    const before = JSON.stringify(entry.manifest);
    entry.manifest.version = targetVersion;

    for (const field of internalDependencyFields) {
      const dependencies = entry.manifest[field];
      if (!dependencies) {
        continue;
      }
      for (const dependencyName of Object.keys(dependencies)) {
        if (groupPackageNames.has(dependencyName)) {
          dependencies[dependencyName] = `^${targetVersion}`;
        }
      }
    }

    if (JSON.stringify(entry.manifest) === before) {
      continue;
    }

    changedFiles.push(path.relative(repoRoot, entry.manifestPath).replaceAll(path.sep, '/'));
    if (write) {
      writeFileSync(entry.manifestPath, `${JSON.stringify(entry.manifest, null, 2)}\n`, 'utf8');
    }
  }

  return {
    group,
    targetVersion,
    releaseTag: getReleaseSetTag(group, targetVersion),
    changedFiles,
  };
}

function isCliInvocation() {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && path.resolve(entrypoint) === fileURLToPath(import.meta.url));
}

if (isCliInvocation()) {
  const [groupName, versionSpec] = process.argv.slice(2);
  if (!groupName || !versionSpec || process.argv.length > 4) {
    usage();
  }

  try {
    const result = prepareReleaseSet({ groupName, versionSpec });
    console.log(
      `[webstir][release] prepared ${result.group.name}@${result.targetVersion} (${result.changedFiles.length} manifests)`,
    );
    for (const file of result.changedFiles) {
      console.log(`  ${file}`);
    }
    console.log(`[webstir][release] after the release PR merges and main CI passes:`);
    console.log(`  git tag ${result.releaseTag}`);
    console.log(`  git push origin ${result.releaseTag}`);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
