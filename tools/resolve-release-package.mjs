#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getFrameworkPackageByCanonicalDir,
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
  let tag = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-dir') {
      packageDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--tag') {
      tag = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
  }

  if (!packageDir && !tag) {
    fail('expected --package-dir or --tag');
  }

  return { packageDir, tag };
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
  const relativePath = normalizeRelativePath(options.packageDir);
  frameworkPackage = getFrameworkPackageByCanonicalDir(relativePath);
  if (!frameworkPackage) {
    fail(`"${relativePath}" is not a canonical release package under packages/**`);
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
