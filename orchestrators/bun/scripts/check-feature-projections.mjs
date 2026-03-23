#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');

const exactProjectionChecks = [
  {
    source: path.join(packageRoot, 'resources', 'features', 'client_nav', 'client_nav.ts'),
    target: path.join(
      packageRoot,
      'resources',
      'templates',
      'full',
      'src',
      'frontend',
      'app',
      'scripts',
      'features',
      'client-nav.ts',
    ),
  },
  {
    source: path.join(packageRoot, 'resources', 'features', 'client_nav', 'document_navigation.ts'),
    target: path.join(
      packageRoot,
      'resources',
      'templates',
      'full',
      'src',
      'frontend',
      'app',
      'scripts',
      'features',
      'document-navigation.ts',
    ),
  },
  {
    source: path.join(packageRoot, 'resources', 'features', 'client_nav', 'form_enhancement.ts'),
    target: path.join(
      packageRoot,
      'resources',
      'templates',
      'full',
      'src',
      'frontend',
      'app',
      'scripts',
      'features',
      'form-enhancement.ts',
    ),
  },
];

async function main() {
  const differences = [];

  for (const check of exactProjectionChecks) {
    const [source, target] = await Promise.all([readFile(check.source), readFile(check.target)]);

    if (!source.equals(target)) {
      differences.push({
        source: path.relative(packageRoot, check.source),
        target: path.relative(packageRoot, check.target),
      });
    }
  }

  if (differences.length > 0) {
    throw new Error(
      [
        'Built-in Bun feature projections are out of sync.',
        'Update the projected template copies or change this check if the relationship is intentionally changing.',
        ...differences.map((difference) => ` - ${difference.source} != ${difference.target}`),
      ].join('\n'),
    );
  }

  console.log(
    `[webstir] feature projections OK (${exactProjectionChecks.length} exact mirrors checked)`,
  );
}

await main();
