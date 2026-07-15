import path from 'node:path';
import { chmod, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { getBackendScaffoldAssets } from '@webstir-io/webstir-backend';
import { getModeScaffoldAssets, getRootScaffoldAssets } from './init-assets.ts';
import {
  getClientNavAssets,
  getContentNavAssets,
  getSearchAssets,
  getSpaAssets,
  renderGithubPagesDeployScript,
  type StaticFeatureAsset,
} from './enable-assets.ts';
import {
  preflightScaffoldAssets,
  preflightWorkspaceWriteTargets,
  type PreflightedScaffoldAsset,
  type ScaffoldAssetDescriptor,
} from './scaffold-path.ts';
import { readWorkspaceDescriptor } from './workspace.ts';
import { readFrontendConfigDocument, type FrontendConfigDocument } from './frontend-config.ts';

interface RepairAsset extends ScaffoldAssetDescriptor {
  readonly executable?: boolean;
}

const SPA_MODE_OWNED_FEATURE_TARGETS = new Set([path.join('src', 'frontend', 'app', 'router.ts')]);
const FULL_MODE_OWNED_CLIENT_NAV_TARGETS = new Set([
  path.join('src', 'frontend', 'app', 'scripts', 'features', 'client-nav.ts'),
  path.join('src', 'frontend', 'app', 'scripts', 'features', 'document-navigation.ts'),
  path.join('src', 'frontend', 'app', 'scripts', 'features', 'form-enhancement.ts'),
]);

interface RepairEnableFlags {
  spa?: boolean;
  clientNav?: boolean;
  search?: boolean;
  contentNav?: boolean;
  backend?: boolean;
  githubPages?: boolean;
}

interface RepairPackageJson {
  scripts?: Record<string, unknown>;
  webstir?: {
    mode?: string;
    enable?: RepairEnableFlags;
  };
}

export interface RunRepairOptions {
  readonly workspaceRoot: string;
  readonly rawArgs: readonly string[];
}

export interface RepairResult {
  readonly workspaceRoot: string;
  readonly mode: string;
  readonly dryRun: boolean;
  readonly changes: readonly string[];
}

export async function runRepair(options: RunRepairOptions): Promise<RepairResult> {
  const dryRun = options.rawArgs.includes('--dry-run');
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  const packageJsonPath = path.join(workspace.root, 'package.json');
  const packageJson = JSON.parse(await readTextFile(packageJsonPath)) as RepairPackageJson;
  const enable = packageJson.webstir?.enable ?? {};
  const changes: string[] = [];
  const assets: RepairAsset[] = [
    ...getRootScaffoldAssets(),
    ...filterModeScaffoldAssets(await getModeScaffoldAssets(workspace.mode), enable),
  ];

  if (enable.spa) {
    appendFeatureAssets(assets, getSpaAssets(), SPA_MODE_OWNED_FEATURE_TARGETS);
  }
  if (enable.clientNav) {
    appendFeatureAssets(assets, getClientNavAssets(), FULL_MODE_OWNED_CLIENT_NAV_TARGETS);
  }
  if (enable.search) {
    appendFeatureAssets(assets, getSearchAssets());
  }
  if (enable.contentNav) {
    appendFeatureAssets(assets, getContentNavAssets());
  }
  if (enable.backend) {
    assets.push(...(await getBackendScaffoldAssets()));
  }

  const preparedAssets = await preflightScaffoldAssets(
    workspace.root,
    assets,
    'restore scaffold assets',
  );
  await preflightWorkspaceWriteTargets(
    workspace.root,
    getFixedRepairWriteTargets(workspace.root, workspace.mode, enable),
    'repair workspace files',
  );
  const frontendConfig = enable.githubPages
    ? await readFrontendConfigDocument(workspace.root)
    : undefined;
  await restoreScaffoldAssets(preparedAssets, changes, dryRun);

  if (enable.clientNav) {
    await ensureAppImport(workspace.root, './scripts/features/client-nav.js', changes, dryRun);
  }
  if (enable.search) {
    await ensureCssLayerIncludes(workspace.root, 'features', changes, dryRun);
    await ensureAppCssImport(
      workspace.root,
      './styles/features/search.css',
      './styles/components/buttons.css',
      changes,
      dryRun,
    );
    await ensureAppImport(workspace.root, './scripts/features/search.js', changes, dryRun);
    await ensureHtmlSearchMode(workspace.root, changes, dryRun);
  }
  if (enable.contentNav) {
    await ensureCssLayerIncludes(workspace.root, 'features', changes, dryRun);
    await ensureAppCssImport(
      workspace.root,
      './styles/features/content-nav.css',
      './styles/components/buttons.css',
      changes,
      dryRun,
    );
    await ensureAppImport(workspace.root, './scripts/features/content-nav.js', changes, dryRun);
  }
  if (enable.backend || workspace.mode === 'api' || workspace.mode === 'full') {
    await ensureBackendTsReference(workspace.root, changes, dryRun);
  }
  if (frontendConfig) {
    await ensureGithubPagesDeployScript(workspace.root, changes, dryRun);
    await ensureDeployScriptEntry(packageJsonPath, changes, dryRun);
    await ensureFrontendConfigBasePath(workspace.root, frontendConfig, changes, dryRun);
  }

  return {
    workspaceRoot: workspace.root,
    mode: workspace.mode,
    dryRun,
    changes: uniqueSorted(changes),
  };
}

function getFixedRepairWriteTargets(
  workspaceRoot: string,
  mode: string,
  enable: RepairEnableFlags,
): readonly string[] {
  const targets: string[] = [];
  const appRoot = path.join(workspaceRoot, 'src', 'frontend', 'app');

  if (enable.clientNav || enable.search || enable.contentNav) {
    targets.push(path.join(appRoot, 'app.ts'));
  }
  if (enable.search || enable.contentNav) {
    targets.push(path.join(appRoot, 'app.css'));
  }
  if (enable.search) {
    targets.push(path.join(appRoot, 'app.html'));
  }
  if (enable.backend || mode === 'api' || mode === 'full') {
    targets.push(path.join(workspaceRoot, 'base.tsconfig.json'));
  }
  if (enable.githubPages) {
    targets.push(
      path.join(workspaceRoot, 'utils', 'deploy-gh-pages.sh'),
      path.join(workspaceRoot, 'package.json'),
      path.join(workspaceRoot, 'src', 'frontend', 'frontend.config.json'),
    );
  }

  return targets;
}

function appendFeatureAssets(
  assets: RepairAsset[],
  featureAssets: readonly StaticFeatureAsset[],
  knownModeOwnedTargets: ReadonlySet<string> = new Set(),
): void {
  const previouslyOwnedTargets = new Set(assets.map((asset) => asset.targetPath));
  assets.push(
    ...featureAssets.filter(
      (asset) =>
        !knownModeOwnedTargets.has(asset.targetPath) ||
        !previouslyOwnedTargets.has(asset.targetPath),
    ),
  );
}

function filterModeScaffoldAssets(
  assets: readonly { sourcePath: string; targetPath: string }[],
  enable: RepairEnableFlags,
): readonly { sourcePath: string; targetPath: string }[] {
  if (!enable.backend) {
    return assets;
  }

  return assets.filter(
    (asset) => !normalizeRelativePath(asset.targetPath).startsWith('src/backend/'),
  );
}

async function restoreScaffoldAssets(
  assets: readonly PreflightedScaffoldAsset<RepairAsset>[],
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  for (const asset of assets) {
    const { sourcePath, targetPath } = asset;
    if (existsSync(targetPath)) {
      continue;
    }

    if (!dryRun) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Bun.write(targetPath, Bun.file(sourcePath));
      if (asset.asset.executable) {
        await chmod(targetPath, 0o755);
      }
    }

    changes.push(asset.relativeTargetPath);
  }
}

async function ensureAppImport(
  workspaceRoot: string,
  importPath: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const appTsPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.ts');
  if (!existsSync(appTsPath)) {
    return;
  }

  const source = await readTextFile(appTsPath);
  const updated = ensureSideEffectImport(source, importPath);
  if (updated === source) {
    return;
  }

  if (!dryRun) {
    await Bun.write(appTsPath, updated);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, appTsPath));
}

async function ensureCssLayerIncludes(
  workspaceRoot: string,
  layerName: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const appCssPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.css');
  if (!existsSync(appCssPath)) {
    return;
  }

  const source = await readTextFile(appCssPath);
  const updated = ensureLayerIncludes(source, layerName);
  if (updated === source) {
    return;
  }

  if (!dryRun) {
    await Bun.write(appCssPath, updated);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, appCssPath));
}

async function ensureAppCssImport(
  workspaceRoot: string,
  importPath: string,
  insertAfterImportPath: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const appCssPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.css');
  if (!existsSync(appCssPath)) {
    return;
  }

  const source = await readTextFile(appCssPath);
  const updated = ensureImportIncludes(source, importPath, insertAfterImportPath);
  if (updated === source) {
    return;
  }

  if (!dryRun) {
    await Bun.write(appCssPath, updated);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, appCssPath));
}

async function ensureHtmlSearchMode(
  workspaceRoot: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const appHtmlPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.html');
  if (!existsSync(appHtmlPath)) {
    return;
  }

  const source = await readTextFile(appHtmlPath);
  if (source.includes('data-webstir-search-styles=')) {
    return;
  }

  const updated = source.replace(
    /<html\b(?![^>]*\bdata-webstir-search-styles=)/i,
    '<html data-webstir-search-styles="css"',
  );
  if (updated === source) {
    return;
  }

  if (!dryRun) {
    await Bun.write(appHtmlPath, updated);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, appHtmlPath));
}

async function ensureBackendTsReference(
  workspaceRoot: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const tsconfigPath = path.join(workspaceRoot, 'base.tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    return;
  }

  const source = await readTextFile(tsconfigPath);
  const root = JSON.parse(source) as Record<string, unknown>;
  const references = Array.isArray(root.references) ? [...root.references] : [];
  const exists = references.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>).path === 'src/backend',
  );
  if (exists) {
    return;
  }

  references.push({ path: 'src/backend' });
  root.references = references;
  const updated = `${JSON.stringify(root, null, 2)}\n`;

  if (!dryRun) {
    await Bun.write(tsconfigPath, updated);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, tsconfigPath));
}

async function ensureGithubPagesDeployScript(
  workspaceRoot: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const deployScriptPath = path.join(workspaceRoot, 'utils', 'deploy-gh-pages.sh');
  if (existsSync(deployScriptPath)) {
    return;
  }

  if (!dryRun) {
    await mkdir(path.dirname(deployScriptPath), { recursive: true });
    await Bun.write(deployScriptPath, renderGithubPagesDeployScript());
    await chmod(deployScriptPath, 0o755);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, deployScriptPath));
}

async function ensureDeployScriptEntry(
  packageJsonPath: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const source = await readTextFile(packageJsonPath);
  const root = JSON.parse(source) as RepairPackageJson & Record<string, unknown>;
  const scripts = root.scripts && typeof root.scripts === 'object' ? { ...root.scripts } : {};
  if (typeof scripts.deploy === 'string') {
    return;
  }

  scripts.deploy = 'bash ./utils/deploy-gh-pages.sh';
  root.scripts = scripts;
  const updated = `${JSON.stringify(root, null, 2)}\n`;

  if (!dryRun) {
    await Bun.write(packageJsonPath, updated);
  }
  changes.push(path.basename(packageJsonPath));
}

async function ensureFrontendConfigBasePath(
  workspaceRoot: string,
  document: FrontendConfigDocument,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const publish = asRecord(document.root.publish);
  if (typeof publish.basePath === 'string' && publish.basePath.length > 0) {
    return;
  }

  publish.basePath = `/${path.basename(workspaceRoot)}`;
  document.root.publish = publish;
  const updated = `${JSON.stringify(document.root, null, 2)}\n`;

  if (!dryRun) {
    await mkdir(path.dirname(document.filePath), { recursive: true });
    await Bun.write(document.filePath, updated);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, document.filePath));
}

async function readTextFile(filePath: string): Promise<string> {
  return await Bun.file(filePath).text();
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

  const layers = match[1]
    .split(',')
    .map((layer) => layer.trim())
    .filter(Boolean);
  if (layers.includes(layerName)) {
    return css;
  }

  const updated = [...layers];
  const utilitiesIndex = updated.indexOf('utilities');
  const overridesIndex = updated.indexOf('overrides');
  const insertIndex =
    utilitiesIndex >= 0 ? utilitiesIndex : overridesIndex >= 0 ? overridesIndex : updated.length;
  updated.splice(insertIndex, 0, layerName);
  const replacement = `@layer ${updated.join(', ')};`;
  return `${css.slice(0, match.index)}${replacement}${css.slice(match.index + match[0].length)}`;
}

function ensureImportIncludes(
  css: string,
  importPath: string,
  insertAfterImportPath: string,
): string {
  if (css.includes(`@import "${importPath}"`) || css.includes(`@import '${importPath}'`)) {
    return css;
  }

  const doubleNeedle = `@import "${insertAfterImportPath}"`;
  const singleNeedle = `@import '${insertAfterImportPath}'`;
  let insertAfterIndex = css.indexOf(doubleNeedle);
  if (insertAfterIndex < 0) {
    insertAfterIndex = css.indexOf(singleNeedle);
  }

  if (insertAfterIndex >= 0) {
    const lineEnd = css.indexOf('\n', insertAfterIndex);
    const insertAt = lineEnd >= 0 ? lineEnd + 1 : css.length;
    return `${css.slice(0, insertAt)}@import "${importPath}";\n${css.slice(insertAt)}`;
  }

  return `${css}\n@import "${importPath}";\n`;
}

function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replaceAll(path.sep, '/');
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join('/');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
