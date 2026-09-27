import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from '@typescript/typescript6';

import { findCssImportPaths } from './css-import-graph.ts';
import type { ScaffoldAssetDescriptor } from './scaffold-path.ts';
import {
  SCRIPT_EXTENSIONS,
  parseTsconfigText,
  scriptReferencedFiles,
  scriptSpecifiers,
  workspaceFiles,
} from './workspace-sources.ts';

interface References {
  readonly root: string;
  /** Missing paths something names directly: stylesheets, HTML URLs, tsconfig entries. */
  readonly paths: Set<string>;
  /** Script imports still to resolve, as `[importing file, specifier]`. */
  readonly imports: Array<readonly [string, string]>;
}

/**
 * The missing scaffold files a workspace still needs: the ones in `required` (paths relative to
 * the workspace), and any file something still names that nothing on disk already answers — a
 * script import, resolved by TypeScript with the importing file's tsconfig (falling back to the
 * scaffold's own `@shared/` and `@app/` aliases), a CSS `@import`, a script or stylesheet in HTML,
 * a triple-slash reference, or a tsconfig `references`, `extends` or `files` entry. Files restored
 * this way are read too, so what they import comes back with them. A scaffold file nothing needs
 * is one the app chose not to have, and stays absent.
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

  const references: References = { root, paths: new Set(), imports: [] };
  for (const filePath of await workspaceFiles(root)) {
    if (isReferenceSource(filePath)) {
      collectReferences(filePath, await readFile(filePath, 'utf8'), references);
    }
  }

  const resolver = createImportResolver(root, [...missing.keys()]);
  const requiredTargets = new Set(required.map((target) => path.resolve(root, target)));
  const selected = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [importer, specifier] of references.imports.splice(0)) {
      const target = resolver(importer, specifier);
      if (target) references.paths.add(target);
    }
    for (const [target, asset] of missing) {
      if (selected.has(target)) continue;
      if (!requiredTargets.has(target) && !references.paths.has(target)) continue;
      selected.add(target);
      grew = true;
      if (isReferenceSource(target)) {
        collectReferences(target, await readFile(asset.sourcePath, 'utf8'), references);
      }
    }
  }

  return assets.filter((asset) => selected.has(path.resolve(root, asset.targetPath)));
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

// The build compiles app scripts from these, so `/app/app.js` in HTML is app.ts or its siblings.
const COMPILED_SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function collectReferences(location: string, text: string, references: References): void {
  const extension = path.extname(location);
  const directory = path.dirname(location);

  if (SCRIPT_EXTENSIONS.has(extension)) {
    for (const specifier of scriptSpecifiers(text, location)) {
      references.imports.push([location, specifier]);
    }
    for (const fileName of scriptReferencedFiles(text)) {
      references.paths.add(path.resolve(directory, fileName));
    }
    return;
  }
  if (extension === '.css') {
    for (const specifier of findCssImportPaths(text)) {
      const resolved = resolveStylesheetImport(references.root, directory, specifier);
      if (resolved) references.paths.add(resolved);
    }
    return;
  }
  if (extension === '.html') {
    for (const match of text.matchAll(DOCUMENT_URL_ATTRIBUTE)) {
      const resolved = resolveDocumentUrl(
        references.root,
        location,
        match[1] ?? match[2] ?? match[3] ?? '',
      );
      if (!resolved) continue;
      const stem = resolved.slice(0, resolved.length - path.extname(resolved).length);
      const compiled =
        path.extname(resolved) === '.js'
          ? COMPILED_SCRIPT_EXTENSIONS.map((scriptExtension) => `${stem}${scriptExtension}`)
          : [resolved];
      if (!compiled.some(isFile)) {
        for (const candidate of compiled) references.paths.add(candidate);
      }
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
}

/** Relative stylesheet imports, and the build's `@app/` alias for the app folder. */
function resolveStylesheetImport(
  root: string,
  directory: string,
  specifier: string,
): string | undefined {
  const bare = specifier.replace(/[?#].*$/, '');
  if (bare.startsWith('./') || bare.startsWith('../')) {
    return path.resolve(directory, bare);
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

/**
 * Resolves a script import the way TypeScript does under the importing file's nearest
 * tsconfig.json (its `paths`, `baseUrl` and `extends`), with bundler resolution, since Webstir
 * bundles every script. An import that resolves on disk needs nothing; one that resolves only once
 * a missing scaffold file is back returns that file. The scaffold's `@shared/` and `@app/` aliases
 * are tried when the tsconfig maps neither.
 */
function createImportResolver(
  root: string,
  missingTargets: readonly string[],
): (importer: string, specifier: string) => string | undefined {
  const missing = new Set(missingTargets);
  const missingDirectories = new Set<string>();
  for (const target of missingTargets) {
    for (let directory = path.dirname(target); directory.startsWith(root); ) {
      missingDirectories.add(directory);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  const diskHost: ts.ModuleResolutionHost = {
    fileExists: (fileName) => isFile(fileName),
    readFile: (fileName) => ts.sys.readFile(fileName),
    directoryExists: (directoryName) => ts.sys.directoryExists(directoryName),
    realpath: ts.sys.realpath,
  };
  const restoredHost: ts.ModuleResolutionHost = {
    ...diskHost,
    fileExists: (fileName) => missing.has(path.resolve(fileName)) || isFile(fileName),
    directoryExists: (directoryName) =>
      missingDirectories.has(path.resolve(directoryName)) || ts.sys.directoryExists(directoryName),
  };
  const optionsByConfig = new Map<string, ts.CompilerOptions>();
  const optionsFor = (importer: string): ts.CompilerOptions => {
    const config = nearestTsconfig(root, importer);
    const cached = config ? optionsByConfig.get(config) : undefined;
    if (cached) return cached;
    const options: ts.CompilerOptions = {
      ...(config ? readCompilerOptions(config) : {}),
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    };
    if (config) optionsByConfig.set(config, options);
    return options;
  };
  const resolve = (
    specifier: string,
    importer: string,
    options: ts.CompilerOptions,
    host: ts.ModuleResolutionHost,
  ) => {
    const resolved = ts.resolveModuleName(specifier, importer, options, host).resolvedModule;
    if (!resolved) return undefined;
    // TypeScript answers `./error.ts` with error.js; a bundler loads only the file it names.
    const named = path.extname(specifier);
    if (TS_EXTENSIONS.has(named) && path.extname(resolved.resolvedFileName) !== named) {
      return undefined;
    }
    return path.resolve(resolved.resolvedFileName);
  };

  return (importer, rawSpecifier) => {
    const specifier = rawSpecifier.replace(/[?#].*$/, '');
    if (!specifier || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) return undefined;
    const options = optionsFor(importer);
    const attempts: Array<readonly [string, string]> = [[specifier, importer]];
    for (const [prefix, folder] of [
      ['@shared/', path.join(root, 'src', 'shared')],
      ['@app/', path.join(root, 'src', 'frontend', 'app')],
    ] as const) {
      if (specifier.startsWith(prefix)) {
        attempts.push([`./${specifier.slice(prefix.length)}`, path.join(folder, 'index.ts')]);
      }
    }
    for (const [candidate, from] of attempts) {
      if (resolve(candidate, from, options, diskHost)) return undefined;
      const restored = resolve(candidate, from, options, restoredHost);
      if (restored && missing.has(restored)) return restored;
    }
    return undefined;
  };
}

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function nearestTsconfig(root: string, filePath: string): string | undefined {
  for (let directory = path.dirname(filePath); directory.startsWith(root); ) {
    const config = path.join(directory, 'tsconfig.json');
    if (isFile(config)) return config;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function readCompilerOptions(configPath: string): ts.CompilerOptions {
  const { config } = ts.readConfigFile(configPath, (fileName) => ts.sys.readFile(fileName));
  if (!config) return {};
  const parsed = ts.parseJsonConfigFileContent(
    config,
    {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      readDirectory: () => [],
      fileExists: (fileName) => ts.sys.fileExists(fileName),
      readFile: (fileName) => ts.sys.readFile(fileName),
    },
    path.dirname(configPath),
    undefined,
    configPath,
  );
  return parsed.options;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}
