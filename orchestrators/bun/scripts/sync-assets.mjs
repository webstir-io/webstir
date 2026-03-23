#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const assetsRoot = path.join(packageRoot, 'assets');
const resourcesRoot = path.join(packageRoot, 'resources');
const templateSourcesRoot = path.join(resourcesRoot, 'templates');
const deploymentSourcesRoot = path.join(resourcesRoot, 'deployment');
const dotnetRoot = path.join(repoRoot, 'orchestrators', 'dotnet');
const demosRoot = path.join(repoRoot, 'examples', 'demos');
const checkOnly = process.argv.includes('--check');

const rootAssets = [
  'Errors.404.html',
  'Errors.500.html',
  'Errors.default.html',
  'types.global.d.ts',
  path.join('types', 'global.d.ts'),
];

const modeTemplates = [
  {
    mode: 'ssg',
    roots: [
      {
        source: path.join(templateSourcesRoot, 'ssg', 'src', 'frontend'),
        target: path.join('src', 'frontend'),
      },
    ],
  },
  {
    mode: 'spa',
    roots: [
      {
        source: path.join(templateSourcesRoot, 'spa', 'src', 'frontend'),
        target: path.join('src', 'frontend'),
      },
      {
        source: path.join(templateSourcesRoot, 'spa', 'src', 'shared'),
        target: path.join('src', 'shared'),
      },
    ],
  },
  {
    mode: 'api',
    roots: [
      {
        source: path.join(templateSourcesRoot, 'api', 'src', 'backend'),
        target: path.join('src', 'backend'),
      },
      {
        source: path.join(templateSourcesRoot, 'api', 'src', 'shared'),
        target: path.join('src', 'shared'),
      },
    ],
  },
  {
    mode: 'full',
    roots: [
      {
        source: path.join(templateSourcesRoot, 'full', 'src', 'frontend'),
        target: path.join('src', 'frontend'),
      },
      {
        source: path.join(templateSourcesRoot, 'full', 'src', 'backend'),
        target: path.join('src', 'backend'),
      },
      {
        source: path.join(templateSourcesRoot, 'full', 'src', 'shared'),
        target: path.join('src', 'shared'),
      },
    ],
  },
];

const features = [
  { source: path.join(packageRoot, 'resources', 'features', 'router'), target: 'router' },
  { source: path.join(packageRoot, 'resources', 'features', 'client_nav'), target: 'client_nav' },
  { source: path.join(packageRoot, 'resources', 'features', 'search'), target: 'search' },
  { source: path.join(packageRoot, 'resources', 'features', 'content_nav'), target: 'content_nav' },
];

async function main() {
  assertNoLegacyAssetReads();
  if (checkOnly) {
    await assertAssetsInSync();
    console.log('[webstir] assets OK');
    return;
  }

  await materializeAssets(assetsRoot);
}

async function materializeAssets(targetAssetsRoot) {
  const templatesRoot = path.join(targetAssetsRoot, 'templates');
  const featuresRoot = path.join(targetAssetsRoot, 'features');
  const deploymentRoot = path.join(targetAssetsRoot, 'deployment');

  await rm(targetAssetsRoot, { recursive: true, force: true });
  await mkdir(templatesRoot, { recursive: true });
  await mkdir(featuresRoot, { recursive: true });
  await mkdir(deploymentRoot, { recursive: true });

  for (const relativePath of rootAssets) {
    const sourcePath = path.join(templateSourcesRoot, 'shared', relativePath);
    const targetPath = path.join(templatesRoot, 'shared', relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { recursive: true });
  }

  for (const template of modeTemplates) {
    for (const root of template.roots) {
      const targetPath = path.join(templatesRoot, template.mode, root.target);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await cp(root.source, targetPath, { recursive: true });
    }
  }

  for (const feature of features) {
    const targetPath = path.join(featuresRoot, feature.target);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(feature.source, targetPath, { recursive: true });
  }

  const deploymentTargetPath = path.join(deploymentRoot, 'sandbox');
  await mkdir(path.dirname(deploymentTargetPath), { recursive: true });
  await cp(path.join(deploymentSourcesRoot, 'sandbox'), deploymentTargetPath, { recursive: true });
}

async function assertAssetsInSync() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-assets-'));
  const expectedAssetsRoot = path.join(tempRoot, 'assets');

  try {
    await materializeAssets(expectedAssetsRoot);
    const differences = await collectDirectoryDifferences(expectedAssetsRoot, assetsRoot);
    if (differences.length === 0) {
      return;
    }

    throw new Error(
      [
        'Generated Bun assets are out of sync with orchestrators/bun/resources.',
        'Run `bun run --filter @webstir-io/webstir build` or `bun scripts/sync-assets.mjs` from orchestrators/bun.',
        ...differences.map((difference) => ` - ${difference}`),
      ].join('\n'),
    );
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function collectDirectoryDifferences(expectedRoot, actualRoot) {
  const [expectedEntries, actualEntries] = await Promise.all([
    collectEntries(expectedRoot),
    collectEntries(actualRoot),
  ]);

  const differences = [];
  const paths = [...new Set([...expectedEntries.keys(), ...actualEntries.keys()])].sort();

  for (const relativePath of paths) {
    const expected = expectedEntries.get(relativePath);
    const actual = actualEntries.get(relativePath);

    if (!expected) {
      differences.push(`unexpected ${actual.type} in assets: ${relativePath}`);
      continue;
    }

    if (!actual) {
      differences.push(`missing ${expected.type} in assets: ${relativePath}`);
      continue;
    }

    if (expected.type !== actual.type) {
      differences.push(
        `type mismatch for ${relativePath}: expected ${expected.type}, found ${actual.type}`,
      );
      continue;
    }

    if (expected.type === 'file' && !expected.content.equals(actual.content)) {
      differences.push(`content mismatch in assets: ${relativePath}`);
    }
  }

  return differences;
}

async function collectEntries(root, currentPath = root, entries = new Map()) {
  const children = await readdir(currentPath, { withFileTypes: true });

  for (const child of children) {
    const childPath = path.join(currentPath, child.name);
    const relativePath = path.relative(root, childPath);

    if (child.isDirectory()) {
      entries.set(relativePath, { type: 'directory' });
      await collectEntries(root, childPath, entries);
      continue;
    }

    if (child.isFile()) {
      entries.set(relativePath, { type: 'file', content: await readFile(childPath) });
    }
  }

  return entries;
}

function assertNoLegacyAssetReads() {
  const sources = [
    ...rootAssets.map((relativePath) => path.join(templateSourcesRoot, 'shared', relativePath)),
    ...modeTemplates.flatMap((template) => template.roots.map((root) => root.source)),
    ...features.map((feature) => feature.source),
    path.join(deploymentSourcesRoot, 'sandbox'),
  ];

  assertSourcesOutsideRoot(dotnetRoot, 'orchestrators/dotnet', sources);
  assertSourcesOutsideRoot(demosRoot, 'examples/demos', sources);
}

function assertSourcesOutsideRoot(disallowedRoot, label, sources) {
  const violations = sources.filter((source) => isInside(disallowedRoot, source));
  if (violations.length === 0) {
    return;
  }

  const details = violations.map((source) => ` - ${path.relative(repoRoot, source)}`).join('\n');
  throw new Error(
    `Bun asset sync cannot read active assets from ${label}.\nMove the source into orchestrators/bun/resources first.\n${details}`,
  );
}

function isInside(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

await main();
