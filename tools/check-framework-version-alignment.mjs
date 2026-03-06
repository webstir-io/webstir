#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const packagePairs = [
  {
    label: '@webstir-io/module-contract',
    canonical: 'packages/contracts/module-contract/package.json',
    embedded: 'orchestrators/dotnet/Framework/Contracts/module-contract/package.json',
  },
  {
    label: '@webstir-io/testing-contract',
    canonical: 'packages/contracts/testing-contract/package.json',
    embedded: 'orchestrators/dotnet/Framework/Contracts/testing-contract/package.json',
  },
  {
    label: '@webstir-io/webstir-backend',
    canonical: 'packages/tooling/webstir-backend/package.json',
    embedded: 'orchestrators/dotnet/Framework/Backend/package.json',
  },
  {
    label: '@webstir-io/webstir-frontend',
    canonical: 'packages/tooling/webstir-frontend/package.json',
    embedded: 'orchestrators/dotnet/Framework/Frontend/package.json',
  },
  {
    label: '@webstir-io/webstir-testing',
    canonical: 'packages/tooling/webstir-testing/package.json',
    embedded: 'orchestrators/dotnet/Framework/Testing/package.json',
  },
];

function readPackageJson(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

const mismatches = [];

for (const pair of packagePairs) {
  const canonicalPkg = readPackageJson(pair.canonical);
  const embeddedPkg = readPackageJson(pair.embedded);

  if (canonicalPkg.version !== embeddedPkg.version) {
    mismatches.push({
      label: pair.label,
      canonicalPath: pair.canonical,
      canonicalVersion: canonicalPkg.version,
      embeddedPath: pair.embedded,
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
