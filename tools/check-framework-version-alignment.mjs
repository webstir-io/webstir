#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { frameworkPackages, getRepoRoot } from './framework-packages.mjs';

const rootDir = getRepoRoot(import.meta.url);

function readPackageJson(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

const mismatches = [];

for (const pkg of frameworkPackages) {
  const canonicalPath = `${pkg.canonicalDir}/package.json`;
  const embeddedPath = `${pkg.embeddedDir}/package.json`;
  const canonicalPkg = readPackageJson(canonicalPath);
  const embeddedPkg = readPackageJson(embeddedPath);

  if (canonicalPkg.version !== embeddedPkg.version) {
    mismatches.push({
      label: pkg.packageName,
      canonicalPath,
      canonicalVersion: canonicalPkg.version,
      embeddedPath,
      embeddedVersion: embeddedPkg.version,
    });
  }
}

if (mismatches.length > 0) {
  console.error('[framework-version-alignment] Embedded orchestrator package versions are out of sync.');
  for (const mismatch of mismatches) {
    console.error(
      `- ${mismatch.label}: canonical ${mismatch.canonicalVersion} (${mismatch.canonicalPath}) != embedded ${mismatch.embeddedVersion} (${mismatch.embeddedPath})`,
    );
  }
  console.error(
    'Update the embedded package manifests under orchestrators/dotnet/Framework/** to match the canonical versions in packages/**.',
  );
  process.exit(1);
}

console.log('[framework-version-alignment] Embedded orchestrator package versions match canonical package versions.');
