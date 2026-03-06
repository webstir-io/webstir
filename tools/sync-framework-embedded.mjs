#!/usr/bin/env node

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  frameworkPackages,
  getFrameworkPackageByCanonicalDir,
  getRepoRoot,
  isManagedEmbeddedContentPath,
  normalizeRelativePath,
  publicManifestFields,
  renderEmbeddedHelperScript,
} from './framework-packages.mjs';

const repoRoot = getRepoRoot(import.meta.url);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function usage() {
  console.error(`Usage: sync-framework-embedded.mjs [--package-dir <dir>] [--dry-run] [--check]

Syncs embedded orchestrator package snapshots from the canonical packages under
packages/**, including managed manifest fields, helper stubs, and overlapping
managed source/template files.`);
  process.exit(1);
}

function parseArgs(argv) {
  let packageDir = '';
  let dryRun = false;
  let check = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--package-dir') {
      packageDir = argv[index + 1] ?? '';
      if (!packageDir) {
        fail('missing value for --package-dir');
      }
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--check') {
      check = true;
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      usage();
    }

    fail(`unknown argument "${arg}"`);
  }

  if (dryRun && check) {
    fail('--dry-run cannot be combined with --check');
  }

  return { packageDir, dryRun, check };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function cloneJson(value) {
  if (value === undefined) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(value));
}

function walkFiles(rootPath, currentPath = rootPath, collected = []) {
  const entries = readDirEntries(currentPath);
  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(rootPath, fullPath, collected);
    } else {
      collected.push(normalizeRelativePath(path.relative(rootPath, fullPath)));
    }
  }

  return collected;
}

function readDirEntries(directoryPath) {
  return readdirSync(directoryPath, { withFileTypes: true });
}

function writeText(relativePath, nextContent, dryRun) {
  const absolutePath = path.join(repoRoot, relativePath);
  const currentContent = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null;
  if (currentContent === nextContent) {
    return false;
  }

  if (!dryRun) {
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, nextContent);
  }

  return true;
}

function syncManifest(pkg, dryRun) {
  const canonicalPackage = readJson(`${pkg.canonicalDir}/package.json`);
  const embeddedPath = `${pkg.embeddedDir}/package.json`;
  const embeddedPackage = readJson(embeddedPath);
  const nextEmbeddedPackage = { ...embeddedPackage };

  for (const field of publicManifestFields) {
    const canonicalValue = cloneJson(canonicalPackage[field]);
    if (canonicalValue === undefined) {
      delete nextEmbeddedPackage[field];
      continue;
    }

    nextEmbeddedPackage[field] = canonicalValue;
  }

  const currentSerialized = JSON.stringify(embeddedPackage, null, 2);
  const nextSerialized = JSON.stringify(nextEmbeddedPackage, null, 2);

  if (currentSerialized === nextSerialized) {
    return [];
  }

  if (!dryRun) {
    writeFileSync(path.join(repoRoot, embeddedPath), `${nextSerialized}\n`);
  }

  return [embeddedPath];
}

function syncHelpers(pkg, dryRun) {
  const changedPaths = [];

  for (const helper of pkg.embeddedHelpers) {
    const relativePath = `${pkg.embeddedDir}/${helper.relativePath}`;
    const nextContent = renderEmbeddedHelperScript(pkg, helper);
    const changed = writeText(relativePath, nextContent, dryRun);
    if (!changed) {
      continue;
    }

    changedPaths.push(relativePath);
    if (!dryRun) {
      chmodSync(path.join(repoRoot, relativePath), 0o755);
    }
  }

  return changedPaths;
}

function syncManagedContent(pkg, dryRun) {
  const changedPaths = [];
  const canonicalRoot = path.join(repoRoot, pkg.canonicalDir);
  const embeddedRoot = path.join(repoRoot, pkg.embeddedDir);
  const canonicalFiles = walkFiles(canonicalRoot).filter(isManagedEmbeddedContentPath);
  const embeddedFiles = new Set(walkFiles(embeddedRoot).filter(isManagedEmbeddedContentPath));

  for (const relativePath of canonicalFiles) {
    const canonicalContent = readFileSync(path.join(canonicalRoot, relativePath), 'utf8');
    const changed = writeText(`${pkg.embeddedDir}/${relativePath}`, canonicalContent, dryRun);
    if (changed) {
      changedPaths.push(`${pkg.embeddedDir}/${relativePath}`);
    }
  }

  for (const relativePath of embeddedFiles) {
    if (canonicalFiles.includes(relativePath)) {
      continue;
    }

    const embeddedPath = path.join(embeddedRoot, relativePath);
    if (!dryRun) {
      rmSync(embeddedPath, { force: true });
    }
    changedPaths.push(`${pkg.embeddedDir}/${relativePath}`);
  }

  return changedPaths;
}

const options = parseArgs(process.argv.slice(2));
let selectedPackages = frameworkPackages;

if (options.packageDir) {
  const normalizedPath = normalizeRelativePath(options.packageDir);
  const selectedPackage = getFrameworkPackageByCanonicalDir(normalizedPath);
  if (!selectedPackage) {
    fail(`"${normalizedPath}" is not a canonical package directory under packages/**`);
  }

  selectedPackages = [selectedPackage];
}

const changedPaths = [];
const previewOnly = options.dryRun || options.check;

for (const pkg of selectedPackages) {
  changedPaths.push(...syncManifest(pkg, previewOnly));
  changedPaths.push(...syncHelpers(pkg, previewOnly));
  changedPaths.push(...syncManagedContent(pkg, previewOnly));
}

if (changedPaths.length === 0) {
  console.log('[sync-framework-embedded] Embedded framework package snapshots already match canonical sources.');
  process.exit(0);
}

const dedupedPaths = [...new Set(changedPaths)];

if (options.check) {
  console.error('[sync-framework-embedded] Embedded framework package snapshots are stale.');
  for (const relativePath of dedupedPaths) {
    console.error(`- ${relativePath}`);
  }
  console.error('Run "pnpm run sync:framework-embedded" and commit the updated embedded snapshot files.');
  process.exit(1);
}

for (const relativePath of dedupedPaths) {
  console.log(`${options.dryRun ? '[dry-run] would update' : '[sync-framework-embedded] updated'} ${relativePath}`);
}
