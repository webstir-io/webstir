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

/** A tsconfig `paths` entry: `prefix*suffix`, or an exact specifier when `exact`. */
interface PathAlias {
  readonly prefix: string;
  readonly suffix: string;
  readonly exact: boolean;
  readonly targets: readonly string[];
}

interface References {
  readonly root: string;
  /** Resolved paths something names, with and without a script extension. */
  readonly paths: Set<string>;
  /** Specifiers that are neither relative nor URLs; aliases may resolve them. */
  readonly bare: Set<string>;
  readonly aliases: PathAlias[];
}

/**
 * The missing scaffold files a workspace still needs: the ones in `required` (paths relative to
 * the workspace), and any file something still names — an import (relative, or through a tsconfig
 * `paths` alias or the scaffold's own `@shared/` and `@app/`), a CSS `@import`, a script or
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

  const references: References = {
    root,
    paths: new Set(),
    bare: new Set(),
    aliases: [
      scaffoldAlias('@shared/*', path.join(root, 'src', 'shared', '*')),
      scaffoldAlias('@app/*', path.join(root, 'src', 'frontend', 'app', '*')),
    ],
  };
  for (const filePath of await workspaceFiles(root)) {
    if (isReferenceSource(filePath)) {
      collectReferences(filePath, await readFile(filePath, 'utf8'), references);
    }
  }

  const requiredTargets = new Set(required.map((target) => path.resolve(root, target)));
  const selected = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    resolveAliases(references);
    for (const [target, asset] of missing) {
      if (selected.has(target)) continue;
      if (!requiredTargets.has(target) && !isReferenced(target, references.paths)) continue;
      selected.add(target);
      grew = true;
      if (isReferenceSource(target)) {
        collectReferences(target, await readFile(asset.sourcePath, 'utf8'), references);
      }
    }
  }

  return assets.filter((asset) => selected.has(path.resolve(root, asset.targetPath)));
}

function isReferenced(target: string, paths: ReadonlySet<string>): boolean {
  return (
    paths.has(target) ||
    (SCRIPT_EXTENSIONS.has(path.extname(target)) && paths.has(withoutExtension(target)))
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

// `src=` and `href=` values, double-quoted, single-quoted or unquoted, as HTML allows.
const DOCUMENT_URL_ATTRIBUTE =
  /(?<![\w-])(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;

function addModule(paths: Set<string>, resolved: string): void {
  paths.add(resolved);
  const extension = path.extname(resolved);
  if (extension === '' || SCRIPT_EXTENSIONS.has(extension)) {
    paths.add(withoutExtension(resolved));
    paths.add(path.join(resolved, 'index'));
  }
}

function collectReferences(location: string, text: string, references: References): void {
  const extension = path.extname(location);
  const directory = path.dirname(location);
  const addSpecifier = (specifier: string) => {
    const bare = specifier.replace(/[?#].*$/, '');
    if (bare === '.' || bare === '..' || bare.startsWith('./') || bare.startsWith('../')) {
      addModule(references.paths, path.resolve(directory, bare));
    } else if (bare && !/^[a-z][a-z0-9+.-]*:/i.test(bare)) {
      references.bare.add(bare);
    }
  };

  if (SCRIPT_EXTENSIONS.has(extension)) {
    for (const specifier of scriptSpecifiers(text, location)) {
      addSpecifier(specifier);
    }
    for (const fileName of scriptReferencedFiles(text)) {
      references.paths.add(path.resolve(directory, fileName));
    }
    return;
  }
  if (extension === '.css') {
    for (const specifier of findCssImportPaths(text)) {
      addSpecifier(specifier);
    }
    return;
  }
  if (extension === '.html') {
    for (const match of text.matchAll(DOCUMENT_URL_ATTRIBUTE)) {
      const url = match[1] ?? match[2] ?? match[3] ?? '';
      const resolved = resolveDocumentUrl(references.root, location, url);
      if (resolved) addModule(references.paths, resolved);
    }
    return;
  }
  if (isTsconfig(location)) {
    collectTsconfigReferences(directory, parseTsconfigText(text, location), references);
  }
}

function collectTsconfigReferences(
  directory: string,
  config: unknown,
  references: References,
): void {
  if (!config || typeof config !== 'object') return;
  const {
    references: projectReferences,
    extends: extendsValue,
    files,
    compilerOptions,
  } = config as Record<string, unknown>;
  for (const reference of Array.isArray(projectReferences) ? projectReferences : []) {
    const referencePath = (reference as { path?: unknown } | null)?.path;
    if (typeof referencePath !== 'string') continue;
    const resolved = path.resolve(directory, referencePath);
    references.paths.add(resolved);
    references.paths.add(path.join(resolved, 'tsconfig.json'));
  }
  for (const base of Array.isArray(extendsValue) ? extendsValue : [extendsValue]) {
    if (typeof base !== 'string' || !base.startsWith('.')) continue;
    const resolved = path.resolve(directory, base);
    references.paths.add(resolved);
    references.paths.add(`${resolved}.json`);
  }
  for (const file of Array.isArray(files) ? files : []) {
    if (typeof file === 'string') {
      references.paths.add(path.resolve(directory, file));
    }
  }

  const options = compilerOptions && typeof compilerOptions === 'object' ? compilerOptions : {};
  const { baseUrl, paths } = options as { baseUrl?: unknown; paths?: unknown };
  if (!paths || typeof paths !== 'object') return;
  const base = typeof baseUrl === 'string' ? path.resolve(directory, baseUrl) : directory;
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets)) continue;
    const star = pattern.indexOf('*');
    references.aliases.push({
      prefix: star < 0 ? pattern : pattern.slice(0, star),
      suffix: star < 0 ? '' : pattern.slice(star + 1),
      exact: star < 0,
      targets: targets
        .filter((target): target is string => typeof target === 'string')
        .map((target) => path.resolve(base, target)),
    });
  }
}

function scaffoldAlias(pattern: string, target: string): PathAlias {
  const star = pattern.indexOf('*');
  return {
    prefix: pattern.slice(0, star),
    suffix: pattern.slice(star + 1),
    exact: false,
    targets: [target],
  };
}

function resolveAliases(references: References): void {
  for (const specifier of references.bare) {
    for (const alias of references.aliases) {
      if (alias.exact) {
        if (specifier !== alias.prefix) continue;
        for (const target of alias.targets) addModule(references.paths, target);
        continue;
      }
      if (
        specifier.length < alias.prefix.length + alias.suffix.length ||
        !specifier.startsWith(alias.prefix) ||
        !specifier.endsWith(alias.suffix)
      ) {
        continue;
      }
      const matched = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length);
      for (const target of alias.targets) {
        addModule(references.paths, target.replace('*', matched));
      }
    }
  }
}

/**
 * A URL in HTML, as the dev server serves it: `/app/...` is the app folder, and the dev runtime
 * scripts (`/hmr.js`, `/refresh.js`) are copied from it to the site root.
 */
function resolveDocumentUrl(root: string, location: string, url: string): string | undefined {
  const bare = url.trim().replace(/[?#].*$/, '');
  if (!bare || bare.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(bare)) {
    return undefined;
  }
  if (!bare.startsWith('/')) {
    return path.resolve(path.dirname(location), bare);
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
