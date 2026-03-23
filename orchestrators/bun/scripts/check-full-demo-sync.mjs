#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const templateRoot = path.join(packageRoot, 'resources', 'templates', 'full', 'src');
const demoRoot = path.join(repoRoot, 'examples', 'demos', 'full', 'src');

const allowedDifferences = new Set(['frontend/app/app.ts', 'frontend/pages/home/index.ts']);

async function main() {
  const [templateEntries, demoEntries] = await Promise.all([
    collectFiles(templateRoot),
    collectFiles(demoRoot),
  ]);

  const differences = [];
  const relativePaths = [...new Set([...templateEntries.keys(), ...demoEntries.keys()])].sort();

  for (const relativePath of relativePaths) {
    const templateFile = templateEntries.get(relativePath);
    const demoFile = demoEntries.get(relativePath);

    if (!templateFile) {
      differences.push(`unexpected demo file: src/${relativePath}`);
      continue;
    }

    if (!demoFile) {
      differences.push(`missing demo file: src/${relativePath}`);
      continue;
    }

    if (templateFile.equals(demoFile)) {
      if (allowedDifferences.has(relativePath)) {
        differences.push(`expected proof-only delta missing: src/${relativePath}`);
      }
      continue;
    }

    if (allowedDifferences.has(relativePath)) {
      continue;
    }

    differences.push(`unexpected content drift: src/${relativePath}`);
  }

  if (differences.length > 0) {
    throw new Error(
      [
        'examples/demos/full no longer matches the Bun full template outside the approved proof-only deltas.',
        'If this drift is intentional, update orchestrators/bun/scripts/check-full-demo-sync.mjs and the docs that describe the relationship.',
        ...differences.map((difference) => ` - ${difference}`),
      ].join('\n'),
    );
  }

  console.log(
    `[webstir] full demo sync OK (${templateEntries.size} files checked, ${allowedDifferences.size} approved deltas)`,
  );
}

async function collectFiles(root, currentPath = root, files = new Map()) {
  const children = await readdir(currentPath, { withFileTypes: true });

  for (const child of children) {
    const childPath = path.join(currentPath, child.name);

    if (child.isDirectory()) {
      await collectFiles(root, childPath, files);
      continue;
    }

    if (!child.isFile()) {
      continue;
    }

    const relativePath = path.relative(root, childPath);
    files.set(relativePath, await readFile(childPath));
  }

  return files;
}

await main();
