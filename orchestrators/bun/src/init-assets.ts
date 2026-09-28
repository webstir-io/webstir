import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

import type { WorkspaceLayers } from '@webstir-io/module-contract/workspace';

import { assetsRoot } from './paths.ts';
import type { Starter } from './types.ts';

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
const serverRootTemplateRoot = path.join(templatesRoot, 'server');
const signInTemplateRoot = path.join(templatesRoot, 'sign-in');

/** What a server app keeps beside its code: its settings example, and what git leaves out. */
export function getServerRootAssets(): readonly ScaffoldAsset[] {
  return [
    createAsset(serverRootTemplateRoot, 'env.example', '.env.example'),
    createAsset(serverRootTemplateRoot, 'gitignore', '.gitignore'),
  ];
}

/** What `enable sign-in` writes: the app's sign-in choices and its two pages. */
export function getSignInAssets(): readonly ScaffoldAsset[] {
  return [
    createAsset(
      signInTemplateRoot,
      path.join('backend', 'sign-in.ts'),
      path.join('src', 'backend', 'sign-in.ts'),
    ),
    createAsset(
      signInTemplateRoot,
      path.join('pages', 'sign-in', 'index.html'),
      path.join('src', 'frontend', 'pages', 'sign-in', 'index.html'),
    ),
    createAsset(
      signInTemplateRoot,
      path.join('pages', 'sign-in-confirm', 'index.html'),
      path.join('src', 'frontend', 'pages', 'sign-in-confirm', 'index.html'),
    ),
  ];
}

export function getRootScaffoldAssets(): readonly ScaffoldAsset[] {
  return [
    createAsset(sharedTemplateRoot, 'AGENTS.md', 'AGENTS.md'),
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

/**
 * The starter whose templates fit an app, for restoring its scaffold: pages and a server are the
 * full starter, no pages is api, and pages alone are ssg when they have content, else spa.
 */
export function starterFor(workspaceRoot: string, layers: WorkspaceLayers): Starter {
  if (layers.pages && layers.server) return 'full';
  if (!layers.pages) return 'api';
  return existsSync(path.join(workspaceRoot, 'src', 'frontend', 'content')) ? 'ssg' : 'spa';
}

export async function getStarterScaffoldAssets(
  starter: Starter,
): Promise<readonly ScaffoldAsset[]> {
  switch (starter) {
    case 'ssg':
      return collectStarterAssets([
        {
          sourceRoot: path.join(ssgTemplateRoot, 'src', 'frontend'),
          targetRoot: path.join('src', 'frontend'),
        },
      ]);
    case 'spa':
      return collectStarterAssets([
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
      return collectStarterAssets([
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
      return collectStarterAssets([
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

/** The one server scaffold, from `init` or `enable backend`: a thin entry and its tsconfig. */
export async function getServerScaffoldAssets(): Promise<readonly ScaffoldAsset[]> {
  return collectStarterAssets([
    {
      sourceRoot: path.join(apiTemplateRoot, 'src', 'backend'),
      targetRoot: path.join('src', 'backend'),
    },
  ]);
}

/**
 * The scaffold an app is held to: its pages' starter, and the one server scaffold when it has a
 * server. A starter's other backend files, such as the full starter's demo module, are app code.
 */
export async function getAppScaffoldAssets(
  workspaceRoot: string,
  layers: WorkspaceLayers,
): Promise<readonly ScaffoldAsset[]> {
  const backendRoot = path.join('src', 'backend') + path.sep;
  const starterAssets = (await getStarterScaffoldAssets(starterFor(workspaceRoot, layers))).filter(
    (asset) => !asset.targetPath.startsWith(backendRoot),
  );
  return layers.server ? [...starterAssets, ...(await getServerScaffoldAssets())] : starterAssets;
}

async function collectStarterAssets(
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
