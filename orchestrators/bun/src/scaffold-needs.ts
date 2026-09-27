import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { findCssImportPaths } from './css-import-graph.ts';
import type { ScaffoldAssetDescriptor } from './scaffold-path.ts';
import {
  SCRIPT_EXTENSIONS,
  parseTsconfigText,
  scriptReferencedFiles,
  scriptSpecifiers,
  workspaceFiles,
} from './workspace-sources.ts';

/**
 * The missing scaffold files a workspace still needs: the ones in `required` (paths relative to
 * the workspace), and any file something still names — an import, a CSS `@import`, a script or
 * stylesheet in HTML, a triple-slash reference, or a tsconfig `references`, `extends` or `files`
 * entry. Files restored this way are read too, so what they import comes back with them. A
 * scaffold file nothing needs is one the app chose not to have, and stays absent.
 */
export async function selectNeededScaffoldAssets<T extends ScaffoldAssetDescriptor>(
  workspaceRoot: string,
  assets: readonly T[],
  required: readonly string[],
): Promise<T[]> {
  const root = path.resolve(workspaceRoot);
  const missing = new Map<string, T>();
  for (const asset of assets) {
    const target = path.resolve(root, asset.targetPath);
    if (!existsSync(target)) {
      missing.set(target, asset);
    }
  }
  if (missing.size === 0) {
    return [];
  }

  const referenced = new Set<string>();
  for (const filePath of await workspaceFiles(root)) {
    if (isReferenceSource(filePath)) {
      collectReferences(root, filePath, await readFile(filePath, 'utf8'), referenced);
    }
  }

  const requiredTargets = new Set(required.map((target) => path.resolve(root, target)));
  const selected = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [target, asset] of missing) {
      if (selected.has(target)) continue;
      if (!requiredTargets.has(target) && !isReferenced(target, referenced)) continue;
      selected.add(target);
      grew = true;
      if (isReferenceSource(target)) {
        collectReferences(root, target, await readFile(asset.sourcePath, 'utf8'), referenced);
      }
    }
  }

  return assets.filter((asset) => selected.has(path.resolve(root, asset.targetPath)));
}

function isReferenced(target: string, referenced: ReadonlySet<string>): boolean {
  return (
    referenced.has(target) ||
    (SCRIPT_EXTENSIONS.has(path.extname(target)) && referenced.has(withoutExtension(target)))
  );
}

function isReferenceSource(filePath: string): boolean {
  const extension = path.extname(filePath);
  return (
    SCRIPT_EXTENSIONS.has(extension) ||
    extension === '.css' ||
    extension === '.html' ||
    isTsconfig(filePath)
  );
}

function isTsconfig(filePath: string): boolean {
  return /(?:^|\.)tsconfig(?:\.[^/\\]+)?\.json$/i.test(path.basename(filePath));
}

function collectReferences(
  root: string,
  location: string,
  text: string,
  referenced: Set<string>,
): void {
  const extension = path.extname(location);
  const directory = path.dirname(location);
  const addModule = (resolved: string | undefined) => {
    if (!resolved) return;
    referenced.add(resolved);
    const resolvedExtension = path.extname(resolved);
    if (resolvedExtension === '' || SCRIPT_EXTENSIONS.has(resolvedExtension)) {
      referenced.add(withoutExtension(resolved));
      referenced.add(path.join(resolved, 'index'));
    }
  };

  if (SCRIPT_EXTENSIONS.has(extension)) {
    for (const specifier of scriptSpecifiers(text, location)) {
      addModule(resolveModuleSpecifier(root, directory, specifier));
    }
    for (const fileName of scriptReferencedFiles(text)) {
      referenced.add(path.resolve(directory, fileName));
    }
    return;
  }
  if (extension === '.css') {
    for (const specifier of findCssImportPaths(text)) {
      addModule(resolveModuleSpecifier(root, directory, specifier));
    }
    return;
  }
  if (extension === '.html') {
    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gis)) {
      addModule(resolveDocumentUrl(root, directory, match[2] ?? ''));
    }
    return;
  }
  if (isTsconfig(location)) {
    collectTsconfigReferences(directory, parseTsconfigText(text, location), referenced);
  }
}

function collectTsconfigReferences(
  directory: string,
  config: unknown,
  referenced: Set<string>,
): void {
  if (!config || typeof config !== 'object') return;
  const { references, extends: extendsValue, files } = config as Record<string, unknown>;
  for (const reference of Array.isArray(references) ? references : []) {
    const referencePath = (reference as { path?: unknown } | null)?.path;
    if (typeof referencePath !== 'string') continue;
    const resolved = path.resolve(directory, referencePath);
    referenced.add(resolved);
    referenced.add(path.join(resolved, 'tsconfig.json'));
  }
  for (const base of Array.isArray(extendsValue) ? extendsValue : [extendsValue]) {
    if (typeof base !== 'string' || !base.startsWith('.')) continue;
    const resolved = path.resolve(directory, base);
    referenced.add(resolved);
    referenced.add(`${resolved}.json`);
  }
  for (const file of Array.isArray(files) ? files : []) {
    if (typeof file === 'string') {
      referenced.add(path.resolve(directory, file));
    }
  }
}

/** Relative specifiers, and the `@shared/` and `@app/` aliases the scaffold itself uses. */
function resolveModuleSpecifier(
  root: string,
  directory: string,
  specifier: string,
): string | undefined {
  const bare = specifier.replace(/[?#].*$/, '');
  if (bare === '.' || bare === '..' || bare.startsWith('./') || bare.startsWith('../')) {
    return path.resolve(directory, bare);
  }
  if (bare.startsWith('@shared/')) {
    return path.join(root, 'src', 'shared', bare.slice('@shared/'.length));
  }
  if (bare.startsWith('@app/')) {
    return path.join(root, 'src', 'frontend', 'app', bare.slice('@app/'.length));
  }
  return undefined;
}

/**
 * A URL in HTML, as the dev server serves it: `/app/...` is the app folder, and the dev runtime
 * scripts (`/hmr.js`, `/refresh.js`) are copied from it to the site root.
 */
function resolveDocumentUrl(root: string, directory: string, url: string): string | undefined {
  const bare = url.trim().replace(/[?#].*$/, '');
  if (!bare || bare.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(bare)) {
    return undefined;
  }
  if (!bare.startsWith('/')) {
    return path.resolve(directory, bare);
  }
  const appRoot = path.join(root, 'src', 'frontend', 'app');
  const sitePath = bare.slice(1);
  if (sitePath.startsWith('app/')) {
    return path.join(appRoot, sitePath.slice('app/'.length));
  }
  if (sitePath && !sitePath.includes('/')) {
    return path.join(appRoot, sitePath);
  }
  return undefined;
}

function withoutExtension(filePath: string): string {
  const extension = path.extname(filePath);
  return SCRIPT_EXTENSIONS.has(extension) ? filePath.slice(0, -extension.length) : filePath;
}
