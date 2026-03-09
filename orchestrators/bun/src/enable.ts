import path from 'node:path';
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { getBackendScaffoldAssets } from '@webstir-io/webstir-backend';
import {
  getClientNavAssets,
  getContentNavAssets,
  getSpaAssets,
  getSearchAssets,
  pageScriptTemplate,
  renderGithubPagesDeployScript,
  renderGithubPagesWorkflow,
  type StaticFeatureAsset,
} from './enable-assets.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

type EnableFeature =
  | 'scripts'
  | 'spa'
  | 'client-nav'
  | 'search'
  | 'content-nav'
  | 'backend'
  | 'github-pages'
  | 'gh-pages'
  | 'gh-deploy';

export interface RunEnableOptions {
  readonly workspaceRoot: string;
  readonly args: readonly string[];
}

export interface EnableResult {
  readonly workspaceRoot: string;
  readonly feature: EnableFeature;
  readonly changes: readonly string[];
}

export async function runEnable(options: RunEnableOptions): Promise<EnableResult> {
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  const [featureToken, ...rest] = options.args;
  if (!featureToken) {
    throw new Error(
      'Missing enable feature. Usage: webstir enable <scripts <page>|spa|client-nav|search|content-nav|backend|github-pages|gh-deploy> --workspace <path>.'
    );
  }

  const feature = parseEnableFeature(featureToken);
  const changes: string[] = [];

  switch (feature) {
    case 'scripts':
      await enableScripts(workspace.root, rest, changes);
      break;
    case 'spa':
      await copyStaticAssets(workspace.root, getSpaAssets(), changes);
      await updatePackageJson(workspace.root, { enableSpa: true }, changes);
      break;
    case 'client-nav':
      await copyStaticAssets(workspace.root, getClientNavAssets(), changes);
      await ensureAppScriptImport(workspace.root, './scripts/features/client-nav.js', changes);
      await updatePackageJson(workspace.root, { enableClientNav: true }, changes);
      break;
    case 'search':
      await copyStaticAssets(workspace.root, getSearchAssets(), changes);
      await ensureAppCssImport(workspace.root, './styles/features/search.css', changes);
      await ensureHtmlSearchMode(workspace.root, changes);
      await ensureAppScriptImport(workspace.root, './scripts/features/search.js', changes);
      await updatePackageJson(workspace.root, { enableSearch: true }, changes);
      break;
    case 'content-nav':
      await copyStaticAssets(workspace.root, getContentNavAssets(), changes);
      await ensureAppCssImport(workspace.root, './styles/features/content-nav.css', changes);
      await ensureAppScriptImport(workspace.root, './scripts/features/content-nav.js', changes);
      await updatePackageJson(workspace.root, { enableContentNav: true }, changes);
      break;
    case 'backend':
      await enableBackend(workspace.root, changes);
      break;
    case 'github-pages':
    case 'gh-pages':
      await enableGithubPages(workspace.root, path.basename(workspace.root), rest[0], false, changes);
      break;
    case 'gh-deploy':
      await enableGithubPages(workspace.root, path.basename(workspace.root), rest[0], true, changes);
      break;
  }

  return {
    workspaceRoot: workspace.root,
    feature,
    changes,
  };
}

function parseEnableFeature(value: string): EnableFeature {
  const normalized = value.trim().toLowerCase() as EnableFeature;
  switch (normalized) {
    case 'scripts':
    case 'spa':
    case 'client-nav':
    case 'search':
    case 'content-nav':
    case 'backend':
    case 'github-pages':
    case 'gh-pages':
    case 'gh-deploy':
      return normalized;
    default:
      throw new Error(
        `Unknown feature "${value}". Expected scripts, spa, client-nav, search, content-nav, backend, github-pages, or gh-deploy.`
      );
  }
}

async function enableScripts(workspaceRoot: string, args: readonly string[], changes: string[]): Promise<void> {
  const pageName = args[0];
  if (!pageName) {
    throw new Error('Usage: webstir enable scripts <page> --workspace <path>.');
  }

  const pageDir = path.join(workspaceRoot, 'src', 'frontend', 'pages', pageName);
  if (!existsSync(pageDir)) {
    throw new Error(`Page "${pageName}" does not exist. Create it first.`);
  }

  const targetPath = path.join(pageDir, 'index.ts');
  if (existsSync(targetPath)) {
    throw new Error(`Page "${pageName}" already has an index.ts script.`);
  }

  await writeTextFile(targetPath, pageScriptTemplate);
  changes.push(relativeWorkspacePath(workspaceRoot, targetPath));
}

async function copyStaticAssets(
  workspaceRoot: string,
  assets: readonly StaticFeatureAsset[],
  changes: string[]
): Promise<void> {
  for (const asset of assets) {
    const targetPath = path.join(workspaceRoot, asset.targetPath);
    const sourceStats = await stat(asset.sourcePath);
    if (!sourceStats.isFile()) {
      throw new Error(`Feature asset not found: ${asset.sourcePath}`);
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    if (!asset.overwrite && existsSync(targetPath)) {
      continue;
    }

    await copyFile(asset.sourcePath, targetPath);
    if (asset.executable) {
      await chmod(targetPath, 0o755);
    }
    changes.push(relativeWorkspacePath(workspaceRoot, targetPath));
  }
}

async function enableBackend(workspaceRoot: string, changes: string[]): Promise<void> {
  const backendRoot = path.join(workspaceRoot, 'src', 'backend');
  if (!existsSync(backendRoot)) {
    const assets = await getBackendScaffoldAssets();
    for (const asset of assets) {
      const targetPath = path.join(workspaceRoot, asset.targetPath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(asset.sourcePath, targetPath);
      changes.push(relativeWorkspacePath(workspaceRoot, targetPath));
    }
  }

  await updatePackageJson(workspaceRoot, { enableBackend: true, mode: 'full' }, changes);
  await ensureTsReference(workspaceRoot, 'src/backend', changes);
}

async function enableGithubPages(
  workspaceRoot: string,
  workspaceName: string,
  basePathArg: string | undefined,
  includeWorkflow: boolean,
  changes: string[]
): Promise<void> {
  const resolvedBasePath = resolveGithubPagesBasePath(basePathArg, workspaceName);
  const deployScriptPath = path.join(workspaceRoot, 'utils', 'deploy-gh-pages.sh');
  await writeTextFile(deployScriptPath, renderGithubPagesDeployScript(), 0o755);
  changes.push(relativeWorkspacePath(workspaceRoot, deployScriptPath));

  if (includeWorkflow) {
    const workflowPath = path.join(workspaceRoot, '.github', 'workflows', 'webstir-gh-pages.yml');
    if (!existsSync(workflowPath)) {
      await writeTextFile(workflowPath, renderGithubPagesWorkflow());
      changes.push(relativeWorkspacePath(workspaceRoot, workflowPath));
    }
  }

  await updateFrontendConfig(workspaceRoot, resolvedBasePath, changes);
  await updatePackageJson(workspaceRoot, { enableGithubPages: true, ensureDeployScript: true }, changes);
}

async function ensureAppScriptImport(
  workspaceRoot: string,
  importPath: string,
  changes: string[]
): Promise<void> {
  const appTsPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.ts');
  if (!existsSync(appTsPath)) {
    return;
  }

  const source = await readFile(appTsPath, 'utf8');
  const updated = ensureSideEffectImport(source, importPath);
  if (updated === source) {
    return;
  }

  await writeFile(appTsPath, updated, 'utf8');
  changes.push(relativeWorkspacePath(workspaceRoot, appTsPath));
}

async function ensureAppCssImport(
  workspaceRoot: string,
  importPath: string,
  changes: string[]
): Promise<void> {
  const appCssPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.css');
  if (!existsSync(appCssPath)) {
    return;
  }

  const source = await readFile(appCssPath, 'utf8');
  let updated = source;
  updated = ensureLayerIncludes(updated, 'features');
  updated = ensureImportIncludes(updated, importPath, './styles/components/buttons.css');
  if (updated === source) {
    return;
  }

  await writeFile(appCssPath, updated, 'utf8');
  changes.push(relativeWorkspacePath(workspaceRoot, appCssPath));
}

async function ensureHtmlSearchMode(workspaceRoot: string, changes: string[]): Promise<void> {
  const appHtmlPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.html');
  if (!existsSync(appHtmlPath)) {
    return;
  }

  const source = await readFile(appHtmlPath, 'utf8');
  if (source.includes('data-webstir-search-styles=')) {
    return;
  }

  const updated = source.replace(
    /<html\b(?![^>]*\bdata-webstir-search-styles=)/i,
    '<html data-webstir-search-styles="css"'
  );
  if (updated === source) {
    return;
  }

  await writeFile(appHtmlPath, updated, 'utf8');
  changes.push(relativeWorkspacePath(workspaceRoot, appHtmlPath));
}

async function updatePackageJson(
  workspaceRoot: string,
  options: {
    readonly enableSpa?: boolean;
    readonly enableClientNav?: boolean;
    readonly enableSearch?: boolean;
    readonly enableContentNav?: boolean;
    readonly enableBackend?: boolean;
    readonly enableGithubPages?: boolean;
    readonly mode?: string;
    readonly ensureDeployScript?: boolean;
  },
  changes: string[]
): Promise<void> {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const source = await readFile(packageJsonPath, 'utf8');
  const root = JSON.parse(source) as Record<string, unknown>;
  const webstir = asRecord(root.webstir);
  const enable = asRecord(webstir.enable);

  if (options.mode) {
    webstir.mode = options.mode;
  }
  if (options.enableSpa !== undefined) {
    enable.spa = options.enableSpa;
  }
  if (options.enableClientNav !== undefined) {
    enable.clientNav = options.enableClientNav;
  }
  if (options.enableSearch !== undefined) {
    enable.search = options.enableSearch;
  }
  if (options.enableContentNav !== undefined) {
    enable.contentNav = options.enableContentNav;
  }
  if (options.enableBackend !== undefined) {
    enable.backend = options.enableBackend;
  }
  if (options.enableGithubPages !== undefined) {
    enable.githubPages = options.enableGithubPages;
  }

  webstir.enable = enable;
  root.webstir = webstir;

  if (options.ensureDeployScript) {
    const scripts = asRecord(root.scripts);
    if (typeof scripts.deploy !== 'string') {
      scripts.deploy = 'bash ./utils/deploy-gh-pages.sh';
    }
    root.scripts = scripts;
  }

  const updated = `${JSON.stringify(root, null, 2)}\n`;
  if (updated === source) {
    return;
  }

  await writeFile(packageJsonPath, updated, 'utf8');
  changes.push(relativeWorkspacePath(workspaceRoot, packageJsonPath));
}

async function updateFrontendConfig(workspaceRoot: string, basePath: string, changes: string[]): Promise<void> {
  const configPath = path.join(workspaceRoot, 'src', 'frontend', 'frontend.config.json');
  let root: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      root = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
    } catch {
      root = {};
    }
  }

  const publish = asRecord(root.publish);
  publish.basePath = basePath;
  root.publish = publish;

  const updated = `${JSON.stringify(root, null, 2)}\n`;
  const current = existsSync(configPath) ? await readFile(configPath, 'utf8') : null;
  if (current === updated) {
    return;
  }

  await writeTextFile(configPath, updated);
  changes.push(relativeWorkspacePath(workspaceRoot, configPath));
}

async function ensureTsReference(workspaceRoot: string, referencePath: string, changes: string[]): Promise<void> {
  const tsconfigPath = path.join(workspaceRoot, 'base.tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    return;
  }

  const source = await readFile(tsconfigPath, 'utf8');
  const root = JSON.parse(source) as Record<string, unknown>;
  const references = Array.isArray(root.references) ? [...root.references] : [];
  const exists = references.some((entry) =>
    typeof entry === 'object'
    && entry !== null
    && (entry as Record<string, unknown>).path === referencePath
  );
  if (!exists) {
    references.push({ path: referencePath });
  }
  root.references = references;

  const updated = `${JSON.stringify(root, null, 2)}\n`;
  if (updated === source) {
    return;
  }

  await writeFile(tsconfigPath, updated, 'utf8');
  changes.push(relativeWorkspacePath(workspaceRoot, tsconfigPath));
}

function resolveGithubPagesBasePath(basePathArg: string | undefined, workspaceName: string): string {
  const candidate = (basePathArg ?? workspaceName).trim();
  if (!candidate || candidate === '/') {
    return '/';
  }

  const withLeadingSlash = candidate.startsWith('/') ? candidate : `/${candidate}`;
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
}

function ensureSideEffectImport(source: string, importPath: string): string {
  const escaped = escapeRegExp(importPath);
  const pattern = new RegExp(`^\\s*import\\s+(['"])${escaped}\\1\\s*;?\\s*$`, 'm');
  if (pattern.test(source)) {
    return source;
  }

  const suffix = source.endsWith('\n') ? '' : '\n';
  return `${source}${suffix}import "${importPath}";\n`;
}

function ensureLayerIncludes(css: string, layerName: string): string {
  const match = css.match(/@layer\s+([^;]+);/);
  if (!match || match.index === undefined) {
    return css;
  }

  const layers = match[1].split(',').map((layer) => layer.trim()).filter(Boolean);
  if (layers.includes(layerName)) {
    return css;
  }

  const updated = [...layers];
  const utilitiesIndex = updated.indexOf('utilities');
  const overridesIndex = updated.indexOf('overrides');
  const insertIndex = utilitiesIndex >= 0 ? utilitiesIndex : overridesIndex >= 0 ? overridesIndex : updated.length;
  updated.splice(insertIndex, 0, layerName);
  const replacement = `@layer ${updated.join(', ')};`;
  return `${css.slice(0, match.index)}${replacement}${css.slice(match.index + match[0].length)}`;
}

function ensureImportIncludes(css: string, importPath: string, insertAfterImportPath: string): string {
  if (css.includes(`@import "${importPath}"`) || css.includes(`@import '${importPath}'`)) {
    return css;
  }

  const doubleNeedle = `@import "${insertAfterImportPath}"`;
  const singleNeedle = `@import '${insertAfterImportPath}'`;
  let insertAfterIndex = css.indexOf(doubleNeedle);
  let needle = doubleNeedle;
  if (insertAfterIndex < 0) {
    insertAfterIndex = css.indexOf(singleNeedle);
    needle = singleNeedle;
  }

  if (insertAfterIndex >= 0) {
    const lineEnd = css.indexOf('\n', insertAfterIndex);
    const insertAt = lineEnd >= 0 ? lineEnd + 1 : css.length;
    return `${css.slice(0, insertAt)}@import "${importPath}";\n${css.slice(insertAt)}`;
  }

  const matches = [...css.matchAll(/@import\s+['"][^'"]+['"];?/g)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const insertAt = (last.index ?? 0) + last[0].length;
    const separator = css[insertAt] === '\n' ? '' : '\n';
    return `${css.slice(0, insertAt)}${separator}@import "${importPath}";\n${css.slice(insertAt)}`;
  }

  return `${css}\n@import "${importPath}";\n`;
}

async function writeTextFile(filePath: string, contents: string, mode?: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
  if (mode !== undefined) {
    await chmod(filePath, mode);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replaceAll(path.sep, '/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
