#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getFrameworkPackageByCanonicalDir,
  getFrameworkPackageByPackageName,
  getFrameworkReleaseTag,
  getRepoRoot,
  normalizeRelativePath,
  parseFrameworkReleaseTag,
} from './framework-packages.mjs';

const repoRoot = getRepoRoot(import.meta.url);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function readPackageJson(relativeDir) {
  const absolutePath = path.join(repoRoot, relativeDir, 'package.json');
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function parseArgs(argv) {
  let packageDir = '';
  let packageName = '';
  let tag = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-dir') {
      packageDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--package-name') {
      packageName = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--tag') {
      tag = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
  }

  if (!packageDir && !packageName && !tag) {
    fail('expected --package-dir, --package-name, or --tag');
  }

  return { packageDir, packageName, tag };
}

const options = parseArgs(process.argv.slice(2));

let frameworkPackage;
let expectedVersion = '';

if (options.tag) {
  const parsed = parseFrameworkReleaseTag(options.tag);
  if (!parsed) {
    fail(`unsupported release tag "${options.tag}"`);
  }

  frameworkPackage = parsed.package;
  expectedVersion = parsed.version;
} else {
  if (options.packageName) {
    frameworkPackage = getFrameworkPackageByPackageName(options.packageName);
    if (!frameworkPackage) {
      fail(`"${options.packageName}" is not a configured release package in the monorepo`);
    }
  } else {
    const relativePath = normalizeRelativePath(options.packageDir);
    frameworkPackage = getFrameworkPackageByCanonicalDir(relativePath);
    if (!frameworkPackage) {
      fail(`"${relativePath}" is not a configured release package in the monorepo`);
    }
  }
}

const packageJson = readPackageJson(frameworkPackage.canonicalDir);

if (expectedVersion && packageJson.version !== expectedVersion) {
  fail(
    `tag version ${expectedVersion} does not match ${frameworkPackage.canonicalDir}/package.json version ${packageJson.version}`,
  );
}

const releaseTag = getFrameworkReleaseTag(frameworkPackage, packageJson.version);

console.log(`package_dir=${frameworkPackage.canonicalDir}`);
console.log(`package_name=${packageJson.name}`);
console.log(`package_version=${packageJson.version}`);
console.log(`release_tag=${releaseTag}`);
