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
import { readWorkspaceDescriptor } from './workspace.ts';

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

  await restoreScaffoldAssets(workspace.root, getRootScaffoldAssets(), changes, dryRun);
  await restoreScaffoldAssets(
    workspace.root,
    await getModeScaffoldAssets(workspace.mode),
    changes,
    dryRun,
  );

  if (enable.spa) {
    await restoreFeatureAssets(workspace.root, getSpaAssets(), changes, dryRun);
  }
  if (enable.clientNav) {
    await restoreFeatureAssets(workspace.root, getClientNavAssets(), changes, dryRun);
    await ensureAppImport(workspace.root, './scripts/features/client-nav.js', changes, dryRun);
  }
  if (enable.search) {
    await restoreFeatureAssets(workspace.root, getSearchAssets(), changes, dryRun);
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
    await restoreFeatureAssets(workspace.root, getContentNavAssets(), changes, dryRun);
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
    await restoreBackendAssets(workspace.root, changes, dryRun);
    await ensureBackendTsReference(workspace.root, changes, dryRun);
  }
  if (enable.githubPages) {
    await ensureGithubPagesDeployScript(workspace.root, changes, dryRun);
    await ensureDeployScriptEntry(packageJsonPath, changes, dryRun);
    await ensureFrontendConfigBasePath(workspace.root, changes, dryRun);
  }

  return {
    workspaceRoot: workspace.root,
    mode: workspace.mode,
    dryRun,
    changes: uniqueSorted(changes),
  };
}

async function restoreScaffoldAssets(
  workspaceRoot: string,
  assets: readonly { sourcePath: string; targetPath: string }[],
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  for (const asset of assets) {
    const targetPath = path.join(workspaceRoot, asset.targetPath);
    if (existsSync(targetPath)) {
      continue;
    }

    if (!dryRun) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Bun.write(targetPath, Bun.file(asset.sourcePath));
    }

    changes.push(relativeWorkspacePath(workspaceRoot, targetPath));
  }
}

async function restoreFeatureAssets(
  workspaceRoot: string,
  assets: readonly StaticFeatureAsset[],
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  for (const asset of assets) {
    const targetPath = path.join(workspaceRoot, asset.targetPath);
    if (existsSync(targetPath)) {
      continue;
    }

    if (!dryRun) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Bun.write(targetPath, Bun.file(asset.sourcePath));
      if (asset.executable) {
        await chmod(targetPath, 0o755);
      }
    }

    changes.push(relativeWorkspacePath(workspaceRoot, targetPath));
  }
}

async function restoreBackendAssets(
  workspaceRoot: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const assets = await getBackendScaffoldAssets();
  for (const asset of assets) {
    const targetPath = path.join(workspaceRoot, asset.targetPath);
    if (existsSync(targetPath)) {
      continue;
    }

    if (!dryRun) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Bun.write(targetPath, Bun.file(asset.sourcePath));
    }

    changes.push(relativeWorkspacePath(workspaceRoot, targetPath));
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
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const configPath = path.join(workspaceRoot, 'src', 'frontend', 'frontend.config.json');
  let root: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      root = JSON.parse(await readTextFile(configPath)) as Record<string, unknown>;
    } catch {
      root = {};
    }
  }

  const publish = asRecord(root.publish);
  if (typeof publish.basePath === 'string' && publish.basePath.length > 0) {
    return;
  }

  publish.basePath = `/${path.basename(workspaceRoot)}`;
  root.publish = publish;
  const updated = `${JSON.stringify(root, null, 2)}\n`;

  if (!dryRun) {
    await mkdir(path.dirname(configPath), { recursive: true });
    await Bun.write(configPath, updated);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, configPath));
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
