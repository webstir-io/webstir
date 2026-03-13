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
const dotnetRoot = path.join(repoRoot, 'orchestrators', 'dotnet');
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
      { source: path.join(repoRoot, 'examples', 'demos', 'ssg', 'base', 'src', 'frontend'), target: path.join('src', 'frontend') },
    ],
  },
  {
    mode: 'spa',
    roots: [
      { source: path.join(repoRoot, 'examples', 'demos', 'spa', 'src', 'frontend'), target: path.join('src', 'frontend') },
      { source: path.join(repoRoot, 'examples', 'demos', 'spa', 'src', 'shared'), target: path.join('src', 'shared') },
    ],
  },
  {
    mode: 'api',
    roots: [
      { source: path.join(repoRoot, 'examples', 'demos', 'api', 'src', 'backend'), target: path.join('src', 'backend') },
      { source: path.join(repoRoot, 'examples', 'demos', 'api', 'src', 'shared'), target: path.join('src', 'shared') },
    ],
  },
  {
    mode: 'full',
    roots: [
      { source: path.join(repoRoot, 'examples', 'demos', 'full', 'src', 'frontend'), target: path.join('src', 'frontend') },
      { source: path.join(repoRoot, 'examples', 'demos', 'full', 'src', 'backend'), target: path.join('src', 'backend') },
      { source: path.join(repoRoot, 'examples', 'demos', 'full', 'src', 'shared'), target: path.join('src', 'shared') },
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
  assertNoDotnetAssetReads();
  if (checkOnly) {
    console.log('[webstir] asset sources OK');
    return;
  }

  await rm(assetsRoot, { recursive: true, force: true });
  await mkdir(templatesRoot, { recursive: true });
  await mkdir(featuresRoot, { recursive: true });

  for (const relativePath of rootAssets) {
    const sourcePath = path.join(repoRoot, 'examples', 'demos', 'spa', relativePath);
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
}

function assertNoDotnetAssetReads() {
  const sources = [
    ...rootAssets.map((relativePath) => path.join(repoRoot, 'examples', 'demos', 'spa', relativePath)),
    ...modeTemplates.flatMap((template) => template.roots.map((root) => root.source)),
    ...features.map((feature) => feature.source),
  ];

  const violations = sources.filter((source) => isInside(dotnetRoot, source));
  if (violations.length === 0) {
    return;
  }

  const details = violations.map((source) => ` - ${path.relative(repoRoot, source)}`).join('\n');
  throw new Error(
    `Bun asset sync cannot read active assets from orchestrators/dotnet.\nMove the source into orchestrators/bun/resources first.\n${details}`
  );
}

function isInside(root, candidate) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

await main();
