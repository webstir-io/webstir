#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  frameworkPackages,
  getRepoRoot,
  isManagedEmbeddedContentPath,
  publicManifestFields,
  renderEmbeddedHelperScript,
} from './framework-packages.mjs';

const repoRoot = getRepoRoot(import.meta.url);

function readPackageJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null;
}

function walkFiles(rootPath, currentPath = rootPath, collected = []) {
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const fullPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(rootPath, fullPath, collected);
    } else {
      collected.push(path.relative(rootPath, fullPath).split(path.sep).join('/'));
    }
  }

  return collected;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

const mismatches = [];

for (const pkg of frameworkPackages) {
  const canonicalPackage = readPackageJson(`${pkg.canonicalDir}/package.json`);
  const embeddedPackage = readPackageJson(`${pkg.embeddedDir}/package.json`);

  for (const field of publicManifestFields) {
    const canonicalValue = canonicalPackage[field] ?? null;
    const embeddedValue = embeddedPackage[field] ?? null;

    if (stableSerialize(canonicalValue) === stableSerialize(embeddedValue)) {
      continue;
    }

    mismatches.push({
      packageName: pkg.packageName,
      field,
      canonicalPath: `${pkg.canonicalDir}/package.json`,
      embeddedPath: `${pkg.embeddedDir}/package.json`,
      canonicalValue,
      embeddedValue,
    });
  }

  for (const helper of pkg.embeddedHelpers) {
    const helperPath = `${pkg.embeddedDir}/${helper.relativePath}`;
    const expectedContent = renderEmbeddedHelperScript(pkg, helper);
    const actualContent = readText(helperPath);

    if (actualContent === expectedContent) {
      continue;
    }

    mismatches.push({
      packageName: pkg.packageName,
      field: `managed helper ${helper.relativePath}`,
      canonicalPath: pkg.canonicalDir,
      embeddedPath: helperPath,
      canonicalValue: expectedContent.trimEnd(),
      embeddedValue: actualContent === null ? '(missing file)' : actualContent.trimEnd(),
    });
  }

  const canonicalRoot = path.join(repoRoot, pkg.canonicalDir);
  const embeddedRoot = path.join(repoRoot, pkg.embeddedDir);
  const canonicalManagedFiles = walkFiles(canonicalRoot).filter(isManagedEmbeddedContentPath);
  const embeddedManagedFiles = new Set(walkFiles(embeddedRoot).filter(isManagedEmbeddedContentPath));

  for (const relativePath of canonicalManagedFiles) {
    const canonicalPath = `${pkg.canonicalDir}/${relativePath}`;
    const embeddedPath = `${pkg.embeddedDir}/${relativePath}`;
    const canonicalContent = readText(canonicalPath);
    const embeddedContent = readText(embeddedPath);

    if (canonicalContent === embeddedContent) {
      continue;
    }

    mismatches.push({
      packageName: pkg.packageName,
      field: `managed content ${relativePath}`,
      canonicalPath,
      embeddedPath,
      canonicalValue: canonicalContent === null ? '(missing file)' : '(content differs)',
      embeddedValue: embeddedContent === null ? '(missing file)' : '(content differs)',
    });
  }

  for (const relativePath of embeddedManagedFiles) {
    if (canonicalManagedFiles.includes(relativePath)) {
      continue;
    }

    mismatches.push({
      packageName: pkg.packageName,
      field: `managed content ${relativePath}`,
      canonicalPath: `${pkg.canonicalDir}/${relativePath}`,
      embeddedPath: `${pkg.embeddedDir}/${relativePath}`,
      canonicalValue: '(missing file)',
      embeddedValue: '(unexpected embedded file)',
    });
  }
}

if (mismatches.length > 0) {
  console.error('[framework-package-sync] Embedded orchestrator package snapshots drifted from canonical packages.');
  for (const mismatch of mismatches) {
    console.error(
      `- ${mismatch.packageName} field "${mismatch.field}" differs between ${mismatch.canonicalPath} and ${mismatch.embeddedPath}`,
    );
    console.error(`  canonical: ${JSON.stringify(mismatch.canonicalValue)}`);
    console.error(`  embedded:  ${JSON.stringify(mismatch.embeddedValue)}`);
  }
  console.error(
    '[framework-package-sync] Run "bun run sync:framework-embedded" after canonical package changes. Embedded copies may only diverge where the orchestrator intentionally owns local build metadata such as repository paths, files, scripts, or devDependencies.',
  );
  process.exit(1);
}

console.log('[framework-package-sync] Embedded orchestrator package snapshots match canonical managed metadata and helper stubs.');
