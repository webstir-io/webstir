import path from 'node:path';
import postcss from 'postcss';
import autoprefixer from 'autoprefixer';
import customMedia from 'postcss-custom-media';
import * as cssoModule from 'csso';
import { FOLDERS, FILES, EXTENSIONS } from '../core/constants.js';
import { ensureDir, pathExists, readFile, writeFile, remove, copy } from '../utils/fs.js';
import { scanGlob } from '../utils/glob.js';
import type { Builder, BuilderContext } from './types.js';
import { getPages } from '../core/pages.js';
import { hashContent } from '../utils/hash.js';
import {
  updatePageManifest,
  updateSharedAssets,
  readSharedAssets,
} from '../assets/assetManifest.js';
import { createCompressedVariants } from '../assets/precompression.js';
import { shouldProcess } from '../utils/changedFile.js';
import { findPageFromChangedFile } from '../utils/pathMatch.js';
import {
  inlineCssImports,
  inlineSourceAppImports,
  isLocalCssImport,
  isWithinOrEqual,
  parseCssImport,
  serializeCssImport,
  stripUrlSuffix,
} from './cssImports.js';

const MODULE_SUFFIX = '.module';
const APP_CSS_BASENAME = 'app';
const csso = ((cssoModule as unknown as { default?: typeof cssoModule }).default ??
  cssoModule) as typeof cssoModule;
const PAGE_IMPORT_PATTERN = /@import\s+(?:url\()?[\s]*['"]([^'"]+)['"][\s]*\)?\s*;?/g;

interface SharedCssArtifacts {
  appCss?: string;
}

export function createCssBuilder(context: BuilderContext): Builder {
  return {
    name: 'css',
    async build(): Promise<void> {
      await processCss(context, false);
    },
    async publish(): Promise<void> {
      await processCss(context, true);
    },
  };
}

async function processCss(context: BuilderContext, isProduction: boolean): Promise<void> {
  const { config } = context;
  if (
    !shouldProcess(context, [
      { directory: config.paths.src.pages, extensions: [EXTENSIONS.css] },
      { directory: config.paths.src.frontend, extensions: [EXTENSIONS.css] },
    ])
  ) {
    return;
  }

  const processor = createPostcssProcessor();
  const customMediaPrelude = await loadCustomMediaPrelude(config);
  const sharedArtifacts = await processAppCss(config, isProduction, processor, customMediaPrelude);
  const targetPage = findPageFromChangedFile(context.changedFile, config.paths.src.pages);
  const pages = await getPages(config.paths.src.pages);

  for (const page of pages) {
    if (targetPage && page.name !== targetPage) {
      continue;
    }
    const entryPath = await resolveCssEntry(page.directory);
    if (!entryPath) {
      continue;
    }

    const css = await readFile(entryPath);
    const inlinedCss = await inlinePageImports(css, page.directory);
    const prepared = applyCustomMediaPrelude(inlinedCss, customMediaPrelude);
    const processed = await processor.process(prepared, {
      from: entryPath,
      map: !isProduction ? { inline: true } : false,
    });
    const normalized = resolveAppImports(
      processed.css,
      isProduction ? sharedArtifacts.appCss : undefined,
    );

    if (isProduction) {
      const inlined = await inlineAppImports(normalized, config.paths.dist.frontend);
      await emitProductionCss(config, page.name, inlined);
    } else {
      await emitDevelopmentCss(config, page.name, normalized);
      await syncPageCssAssetsForDevelopment(
        page.directory,
        path.join(config.paths.build.pages, page.name),
        entryPath,
      );
    }
  }
}

async function emitDevelopmentCss(
  config: BuilderContext['config'],
  pageName: string,
  css: string,
): Promise<void> {
  const outputDir = path.join(config.paths.build.pages, pageName);
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, `${FILES.index}${EXTENSIONS.css}`);
  await writeFile(outputPath, css);
}

async function emitProductionCss(
  config: BuilderContext['config'],
  pageName: string,
  css: string,
): Promise<void> {
  const minified = csso.minify(css).css;
  const hash = hashContent(minified);
  const fileName = `${FILES.index}-${hash}${EXTENSIONS.css}`;
  const outputDir = path.join(config.paths.dist.pages, pageName);
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, fileName);
  await writeFile(outputPath, minified);
  if (config.features.precompression) {
    await createCompressedVariants(outputPath);
  } else {
    await Promise.all([
      remove(`${outputPath}${EXTENSIONS.br}`).catch(() => undefined),
      remove(`${outputPath}${EXTENSIONS.gz}`).catch(() => undefined),
    ]);
  }
  await updatePageManifest(outputDir, pageName, (manifest) => {
    manifest.css = fileName;
  });
}

async function syncPageCssAssetsForDevelopment(
  pageDirectory: string,
  outputDir: string,
  entryPath: string,
): Promise<void> {
  const sourceFiles = await scanGlob('**/*.css', { cwd: pageDirectory });
  const entryRelative = normalizeForwardSlashes(path.relative(pageDirectory, entryPath));

  const copySet = new Set<string>();
  for (const relative of sourceFiles) {
    const normalized = normalizeForwardSlashes(relative);
    if (normalized === entryRelative) {
      continue;
    }

    copySet.add(normalized);
    const sourcePath = path.join(pageDirectory, relative);
    const destinationPath = path.join(outputDir, relative);
    await ensureDir(path.dirname(destinationPath));
    await copy(sourcePath, destinationPath);
  }

  const existingFiles = await scanGlob('**/*.css', { cwd: outputDir });
  for (const relative of existingFiles) {
    const normalized = normalizeForwardSlashes(relative);
    if (normalized === `${FILES.index}${EXTENSIONS.css}`) {
      continue;
    }

    if (!copySet.has(normalized)) {
      await remove(path.join(outputDir, relative)).catch(() => undefined);
    }
  }
}

async function processAppCss(
  config: BuilderContext['config'],
  isProduction: boolean,
  processor: postcss.Processor,
  customMediaPrelude: string,
): Promise<SharedCssArtifacts> {
  const appCssPath = path.join(config.paths.src.app, 'app.css');
  if (!(await pathExists(appCssPath))) {
    return {};
  }

  const source = applyCustomMediaPrelude(await readFile(appCssPath), customMediaPrelude);

  if (isProduction) {
    const stylesMap = await emitAppStylesProduction(config, processor, customMediaPrelude);
    const processed = await processor.process(source, { from: appCssPath, map: false });
    const rewritten = rewriteAppStyleImports(processed.css, stylesMap);
    const inlined = await inlineAppImports(rewritten, config.paths.dist.frontend);
    const fileName = await emitAppProductionCss(config, inlined);
    await updateSharedAssets(config.paths.dist.frontend, (shared) => {
      shared.css = fileName;
    });
    return { appCss: fileName };
  }

  const processed = await processor.process(source, { from: appCssPath, map: { inline: true } });
  const stylesVersion = await computeAppStylesVersion(config.paths.src.app);
  const rewritten = rewriteAppStyleImportsForDevelopment(processed.css, stylesVersion);
  await emitAppDevelopmentCss(config, rewritten);
  await syncAppStyles(
    config.paths.src.app,
    path.join(config.paths.build.frontend, FOLDERS.app),
    processor,
    customMediaPrelude,
  );
  return {};
}

function createPostcssProcessor(): postcss.Processor {
  return postcss([customMedia(), autoprefixer]);
}

async function loadCustomMediaPrelude(config: BuilderContext['config']): Promise<string> {
  const tokensPath = path.join(config.paths.src.app, 'styles', 'tokens.css');
  if (!(await pathExists(tokensPath))) {
    return '';
  }

  const contents = await readFile(tokensPath);
  const matches = contents.match(/^[\t ]*@custom-media[^\n]*;[\t ]*$/gm) ?? [];
  if (matches.length === 0) {
    return '';
  }

  return `${matches.join('\n')}\n`;
}

function applyCustomMediaPrelude(css: string, prelude: string): string {
  if (!prelude) {
    return css;
  }

  if (!css.includes('@media (--')) {
    return css;
  }

  if (css.includes('@custom-media')) {
    return css;
  }

  return `${prelude}${css}`;
}

async function emitAppDevelopmentCss(config: BuilderContext['config'], css: string): Promise<void> {
  const outputDir = path.join(config.paths.build.frontend, FOLDERS.app);
  await ensureDir(outputDir);
  await writeFile(path.join(outputDir, 'app.css'), css);
}

async function emitAppProductionCss(
  config: BuilderContext['config'],
  css: string,
): Promise<string> {
  const { css: stripped, layerOrder } = stripAppLayerOrderStatement(css);
  const minified = restoreAppLayerOrderStatement(csso.minify(stripped).css, layerOrder);
  const hash = hashContent(minified);
  const fileName = `${APP_CSS_BASENAME}-${hash}${EXTENSIONS.css}`;
  const outputDir = path.join(config.paths.dist.frontend, FOLDERS.app);
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, fileName);
  await writeFile(outputPath, minified);

  if (config.features.precompression) {
    await createCompressedVariants(outputPath);
  } else {
    await Promise.all([
      remove(`${outputPath}${EXTENSIONS.br}`).catch(() => undefined),
      remove(`${outputPath}${EXTENSIONS.gz}`).catch(() => undefined),
    ]);
  }

  // Remove previously hashed variants to avoid stale files.
  const existing = await readSharedAssets(config.paths.dist.frontend);
  const previousFile = existing?.css;
  if (previousFile && previousFile !== fileName) {
    const previousPath = path.join(outputDir, previousFile);
    await remove(previousPath).catch(() => undefined);
    await remove(`${previousPath}${EXTENSIONS.br}`).catch(() => undefined);
    await remove(`${previousPath}${EXTENSIONS.gz}`).catch(() => undefined);
  }

  return fileName;
}

async function syncAppStyles(
  sourceAppDir: string,
  destinationAppDir: string,
  processor: postcss.Processor,
  customMediaPrelude: string,
): Promise<void> {
  const stylesSource = path.join(sourceAppDir, 'styles');
  if (!(await pathExists(stylesSource))) {
    return;
  }

  const stylesDestination = path.join(destinationAppDir, 'styles');
  await ensureDir(stylesDestination);

  const files = await scanGlob('**/*', { cwd: stylesSource });
  for (const relative of files) {
    const sourcePath = path.join(stylesSource, relative);
    const destinationPath = path.join(stylesDestination, relative);
    await ensureDir(path.dirname(destinationPath));

    if (!relative.endsWith(EXTENSIONS.css)) {
      await copy(sourcePath, destinationPath);
      continue;
    }

    const source = applyCustomMediaPrelude(await readFile(sourcePath), customMediaPrelude);
    const processed = await processor.process(source, { from: sourcePath, map: { inline: true } });
    await writeFile(destinationPath, processed.css);
  }
}

async function computeAppStylesVersion(sourceAppDir: string): Promise<string> {
  const stylesDir = path.join(sourceAppDir, 'styles');
  if (!(await pathExists(stylesDir))) {
    return 'no-styles';
  }

  const files = await scanGlob('**/*.css', { cwd: stylesDir });
  if (files.length === 0) {
    return 'no-styles';
  }

  let fingerprint = '';
  for (const relative of files) {
    const contents = await readFile(path.join(stylesDir, relative));
    fingerprint += `${normalizeForwardSlashes(relative)}\0${contents}\0`;
  }

  return hashContent(fingerprint, 10);
}

function rewriteAppStyleImportsForDevelopment(css: string, stylesVersion: string): string {
  const importPattern = /(@import\s+['"])(?:\.\/)?(styles\/[^'"]+?\.css)(\?v=[^'"]+)?(['"];?)/g;
  return css.replace(importPattern, `$1./$2?v=${stylesVersion}$4`);
}

function resolveAppImports(css: string, appCssFile?: string): string {
  let result = css;

  if (appCssFile) {
    result = result.replace(/@import\s+['"]@app\/app\.css['"];?/g, `@import "/app/${appCssFile}";`);
  }

  return result.replace(/@app\//g, '/app/');
}

async function inlinePageImports(
  css: string,
  pageDirectory: string,
  seen: Set<string> = new Set(),
): Promise<string> {
  const segments: string[] = [];
  let lastIndex = 0;

  for (const match of css.matchAll(PAGE_IMPORT_PATTERN)) {
    const index = match.index ?? 0;
    segments.push(css.slice(lastIndex, index));

    const importPath = String(match[1] ?? '').trim();
    if (!shouldInlinePageImport(importPath)) {
      segments.push(match[0]);
      lastIndex = index + match[0].length;
      continue;
    }

    const resolved = path.resolve(pageDirectory, importPath);
    if (!isWithin(resolved, pageDirectory)) {
      segments.push(match[0]);
      lastIndex = index + match[0].length;
      continue;
    }

    const key = resolved;
    if (seen.has(key)) {
      lastIndex = index + match[0].length;
      continue;
    }

    if (!(await pathExists(resolved))) {
      segments.push(match[0]);
      lastIndex = index + match[0].length;
      continue;
    }

    seen.add(key);
    const imported = await readFile(resolved);
    const inlined = await inlinePageImports(imported, pageDirectory, seen);
    seen.delete(key);
    segments.push(inlined);

    lastIndex = index + match[0].length;
  }

  segments.push(css.slice(lastIndex));
  return segments.join('');
}

function shouldInlinePageImport(importPath: string): boolean {
  if (importPath.length === 0) {
    return false;
  }

  if (!importPath.endsWith(EXTENSIONS.css)) {
    return false;
  }

  if (
    importPath.startsWith('/') ||
    importPath.startsWith('http:') ||
    importPath.startsWith('https:')
  ) {
    return false;
  }

  if (importPath.startsWith('@') || importPath.includes('?') || importPath.includes('#')) {
    return false;
  }

  if (importPath.includes('..')) {
    return false;
  }

  return true;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function inlineAppImports(css: string, distRoot: string): Promise<string> {
  const appRoot = path.join(distRoot, FOLDERS.app);
  await ensureDir(appRoot);
  const entryPath = path.join(distRoot, '__app-import-entry.css');
  return inlineCssImports(css, entryPath, appRoot, (importPath, containingPath) => {
    if (importPath.startsWith('/app/')) {
      return path.resolve(appRoot, stripUrlSuffix(importPath.slice('/app/'.length)));
    }

    if (isWithinOrEqual(containingPath, appRoot) && isLocalCssImport(importPath)) {
      return path.resolve(path.dirname(containingPath), stripUrlSuffix(importPath));
    }

    return null;
  });
}

async function emitAppStylesProduction(
  config: BuilderContext['config'],
  processor: postcss.Processor,
  customMediaPrelude: string,
): Promise<Map<string, string>> {
  const sourceDir = path.join(config.paths.src.app, 'styles');
  const mapping = new Map<string, string>();

  if (!(await pathExists(sourceDir))) {
    const destinationDir = path.join(config.paths.dist.frontend, FOLDERS.app, 'styles');
    await remove(destinationDir).catch(() => undefined);
    return mapping;
  }

  const destinationDir = path.join(config.paths.dist.frontend, FOLDERS.app, 'styles');
  await remove(destinationDir).catch(() => undefined);

  const files = await scanGlob('**/*.css', { cwd: sourceDir });
  for (const relative of files) {
    const sourcePath = path.join(sourceDir, relative);
    const bundled = await inlineSourceAppImports(await readFile(sourcePath), sourcePath, sourceDir);
    const source = applyCustomMediaPrelude(bundled, customMediaPrelude);
    const processed = await processor.process(source, { from: sourcePath, map: false });
    const minified = csso.minify(processed.css).css;
    const hash = hashContent(minified);
    const parsed = path.parse(relative);
    const hashedName = `${parsed.name}-${hash}${EXTENSIONS.css}`;
    const relativeHashedPath = parsed.dir ? path.join(parsed.dir, hashedName) : hashedName;
    const destinationPath = path.join(destinationDir, relativeHashedPath);
    await ensureDir(path.dirname(destinationPath));
    await writeFile(destinationPath, minified);

    if (config.features.precompression) {
      await createCompressedVariants(destinationPath);
    } else {
      await Promise.all([
        remove(`${destinationPath}${EXTENSIONS.br}`).catch(() => undefined),
        remove(`${destinationPath}${EXTENSIONS.gz}`).catch(() => undefined),
      ]);
    }

    mapping.set(
      normalizeForwardSlashes(relative),
      normalizeForwardSlashes(path.join('styles', relativeHashedPath)),
    );
  }

  return mapping;
}

function rewriteAppStyleImports(css: string, stylesMap: Map<string, string>): string {
  const root = postcss.parse(css);
  root.walkAtRules('import', (rule) => {
    const parsed = parseCssImport(rule.params);
    if (!parsed || !isLocalCssImport(parsed.path)) {
      return;
    }

    const normalized = path.posix.normalize(
      normalizeForwardSlashes(stripUrlSuffix(parsed.path)).replace(/^\.\//, ''),
    );
    if (!normalized.startsWith('styles/')) {
      throw new Error(`CSS @import escapes the permitted app styles root: ${parsed.path}`);
    }

    const relative = normalized.slice('styles/'.length);
    const hashed = stylesMap.get(relative);
    if (!hashed) {
      throw new Error(`Unable to resolve local CSS @import from app.css: ${parsed.path}`);
    }

    rule.params = serializeCssImport(`/app/${hashed}`, parsed.qualifiers);
  });

  return root.toString();
}

function normalizeForwardSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function stripAppLayerOrderStatement(css: string): { css: string; layerOrder?: string } {
  const layerMatch = css.match(/@layer[^;]*;/);
  if (!layerMatch || layerMatch.index === undefined) {
    return { css };
  }

  const layerText = layerMatch[0];
  if (layerText.includes('{')) {
    return { css };
  }

  const withoutLayer =
    css.slice(0, layerMatch.index) + css.slice(layerMatch.index + layerText.length);
  return { css: withoutLayer, layerOrder: layerText.trim() };
}

function restoreAppLayerOrderStatement(css: string, layerOrder?: string): string {
  if (!layerOrder) {
    return css;
  }

  const charsetMatch = css.match(/^@charset[^;]*;/);
  if (charsetMatch && charsetMatch.index === 0) {
    const charsetText = charsetMatch[0];
    const rest = css.slice(charsetText.length);
    return `${charsetText}${layerOrder}${rest}`;
  }

  return `${layerOrder}${css}`;
}

async function resolveCssEntry(pageDirectory: string): Promise<string | null> {
  const modulePath = path.join(pageDirectory, `${FILES.index}${MODULE_SUFFIX}${EXTENSIONS.css}`);
  if (await pathExists(modulePath)) {
    return modulePath;
  }

  const plainPath = path.join(pageDirectory, `${FILES.index}${EXTENSIONS.css}`);
  if (await pathExists(plainPath)) {
    return plainPath;
  }

  return null;
}
