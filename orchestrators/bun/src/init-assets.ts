import path from 'node:path';
import { readdir } from 'node:fs/promises';

import { assetsRoot } from './paths.ts';
import type { WorkspaceMode } from './types.ts';

export interface ScaffoldAsset {
  readonly sourcePath: string;
  readonly targetPath: string;
}

const templatesRoot = path.join(assetsRoot, 'templates');
const sharedTemplateRoot = path.join(templatesRoot, 'shared');
const ssgTemplateRoot = path.join(templatesRoot, 'ssg');
const spaTemplateRoot = path.join(templatesRoot, 'spa');
const apiTemplateRoot = path.join(templatesRoot, 'api');
const fullTemplateRoot = path.join(templatesRoot, 'full');

export function getRootScaffoldAssets(): readonly ScaffoldAsset[] {
  return [
    createAsset(sharedTemplateRoot, 'Errors.404.html', 'Errors.404.html'),
    createAsset(sharedTemplateRoot, 'Errors.500.html', 'Errors.500.html'),
    createAsset(sharedTemplateRoot, 'Errors.default.html', 'Errors.default.html'),
    createAsset(sharedTemplateRoot, 'types.global.d.ts', 'types.global.d.ts'),
    createAsset(
      sharedTemplateRoot,
      path.join('types', 'global.d.ts'),
      path.join('types', 'global.d.ts'),
    ),
  ];
}

export async function getModeScaffoldAssets(
  mode: WorkspaceMode,
): Promise<readonly ScaffoldAsset[]> {
  switch (mode) {
    case 'ssg':
      return collectModeAssets([
        {
          sourceRoot: path.join(ssgTemplateRoot, 'src', 'frontend'),
          targetRoot: path.join('src', 'frontend'),
        },
      ]);
    case 'spa':
      return collectModeAssets([
        {
          sourceRoot: path.join(spaTemplateRoot, 'src', 'frontend'),
          targetRoot: path.join('src', 'frontend'),
        },
        {
          sourceRoot: path.join(spaTemplateRoot, 'src', 'shared'),
          targetRoot: path.join('src', 'shared'),
        },
      ]);
    case 'api':
      return collectModeAssets([
        {
          sourceRoot: path.join(apiTemplateRoot, 'src', 'backend'),
          targetRoot: path.join('src', 'backend'),
        },
        {
          sourceRoot: path.join(apiTemplateRoot, 'src', 'shared'),
          targetRoot: path.join('src', 'shared'),
        },
      ]);
    case 'full':
      return collectModeAssets([
        {
          sourceRoot: path.join(fullTemplateRoot, 'src', 'frontend'),
          targetRoot: path.join('src', 'frontend'),
        },
        {
          sourceRoot: path.join(fullTemplateRoot, 'src', 'backend'),
          targetRoot: path.join('src', 'backend'),
        },
        {
          sourceRoot: path.join(fullTemplateRoot, 'src', 'shared'),
          targetRoot: path.join('src', 'shared'),
        },
      ]);
  }
}

async function collectModeAssets(
  roots: readonly { sourceRoot: string; targetRoot: string }[],
): Promise<readonly ScaffoldAsset[]> {
  const assets: ScaffoldAsset[] = [];
  for (const root of roots) {
    const relativePaths = await listFiles(root.sourceRoot);
    for (const relativePath of relativePaths) {
      assets.push({
        sourcePath: path.join(root.sourceRoot, relativePath),
        targetPath: path.join(root.targetRoot, relativePath),
      });
    }
  }

  return assets.sort((left, right) => left.targetPath.localeCompare(right.targetPath));
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const nextRelative = prefix ? path.join(prefix, entry.name) : entry.name;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath, nextRelative)));
      continue;
    }

    if (entry.isFile()) {
      files.push(nextRelative);
    }
  }

  return files;
}

function createAsset(root: string, sourceRelativePath: string, targetPath: string): ScaffoldAsset {
  return {
    sourcePath: path.join(root, sourceRelativePath),
    targetPath,
  };
}
