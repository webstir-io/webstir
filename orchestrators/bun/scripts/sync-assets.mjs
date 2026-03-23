#!/usr/bin/env node

import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const assetsRoot = path.join(packageRoot, 'assets');
const templatesRoot = path.join(assetsRoot, 'templates');
const featuresRoot = path.join(assetsRoot, 'features');
const deploymentRoot = path.join(assetsRoot, 'deployment');
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
    console.log('[webstir] asset sources OK');
    return;
  }

  await rm(assetsRoot, { recursive: true, force: true });
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
