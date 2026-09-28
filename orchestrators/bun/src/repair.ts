import path from 'node:path';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { getAppScaffoldAssets, getRootScaffoldAssets } from './init-assets.ts';
import {
  renderGithubPagesDeployScript,
  renderS3CloudFrontDeployScript,
  renderS3CloudFrontFunction,
} from './enable-assets.ts';
import { adoptPackagedFeature, appEntryPaths, legacyFeaturePaths } from './feature-imports.ts';
import {
  preflightScaffoldAssets,
  preflightWorkspaceWriteTargets,
  type PreflightedScaffoldAsset,
  type ScaffoldAssetDescriptor,
} from './scaffold-path.ts';
import { classifyHmrClient, migrateHotModuleRegistry } from './hot-module-migration.ts';
import { readWorkspaceDescriptor } from './workspace.ts';
import { readFrontendConfigDocument, type FrontendConfigDocument } from './frontend-config.ts';
import type { WorkspaceLayers } from '@webstir-io/module-contract/workspace';
import ts from '@typescript/typescript6';

interface RepairAsset extends ScaffoldAssetDescriptor {
  readonly executable?: boolean;
}

// The SPA router Webstir scaffolded before client-nav became the navigation; nothing uses it.
const RETIRED_ROUTER_FILES = [
  'src/frontend/app/router.ts',
  'src/frontend/app/router-types.ts',
  'src/frontend/app/navigation.ts',
  'src/shared/router-types.ts',
];

interface RepairEnableFlags {
  clientNav?: boolean;
  search?: boolean;
  contentNav?: boolean;
  githubPages?: boolean;
  s3CloudFront?: boolean;
}

interface RepairPackageJson {
  scripts?: Record<string, unknown>;
  webstir?: {
    enable?: RepairEnableFlags;
  };
}

export interface RunRepairOptions {
  readonly workspaceRoot: string;
  readonly rawArgs: readonly string[];
}

export interface RepairResult {
  readonly workspaceRoot: string;
  readonly layers: WorkspaceLayers;
  readonly dryRun: boolean;
  readonly restoreScaffold: boolean;
  readonly changes: readonly string[];
  /** Scaffold files the workspace does not have; `--restore-scaffold` re-creates them. */
  readonly missingScaffold: readonly string[];
  readonly notes: readonly string[];
}

export const RESTORE_SCAFFOLD_FLAG = '--restore-scaffold';

export async function runRepair(options: RunRepairOptions): Promise<RepairResult> {
  const dryRun = options.rawArgs.includes('--dry-run');
  const restoreScaffold = options.rawArgs.includes(RESTORE_SCAFFOLD_FLAG);
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  const packageJsonPath = path.join(workspace.root, 'package.json');
  const packageJson = JSON.parse(await readTextFile(packageJsonPath)) as RepairPackageJson;
  const enable = packageJson.webstir?.enable ?? {};
  const changes: string[] = [];
  const notes: string[] = [];
  const assets: RepairAsset[] = [
    ...getRootScaffoldAssets(),
    ...filterStarterScaffoldAssets(await getAppScaffoldAssets(workspace.root, workspace.layers)),
  ];

  // Generated instructions become app-owned. Existing files, links, or directories
  // must not block unrelated scaffold repairs or be rewritten by the framework.
  let hasAppInstructions = false;
  try {
    await lstat(path.join(workspace.root, 'AGENTS.md'));
    hasAppInstructions = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // Repair migrates what Webstir moved or changed. Missing scaffold files may be ones the app
  // removed on purpose, so they come back only when asked for with --restore-scaffold.
  const restorableAssets = hasAppInstructions
    ? assets.filter((asset) => asset.targetPath !== 'AGENTS.md')
    : assets;
  const missingScaffold = uniqueSorted(
    restorableAssets
      .filter((asset) => !existsSync(path.join(workspace.root, asset.targetPath)))
      .map((asset) => normalizeRelativePath(asset.targetPath)),
  );
  const preparedAssets = restoreScaffold
    ? await preflightScaffoldAssets(workspace.root, restorableAssets, 'restore scaffold assets')
    : [];
  await preflightWorkspaceWriteTargets(
    workspace.root,
    getFixedRepairWriteTargets(workspace.root, workspace.layers, enable),
    'repair workspace files',
  );
  const frontendConfig = enable.githubPages
    ? await readFrontendConfigDocument(workspace.root)
    : undefined;
  await restoreScaffoldAssets(preparedAssets, changes, dryRun);
  await ensureHotModulePair(workspace.root, assets, changes, notes, dryRun);
  noteRetiredRouter(workspace.root, notes);
  await retireShapeFields(packageJsonPath, changes, notes, dryRun);

  if (enable.search || enable.contentNav) {
    await ensureCssLayerIncludes(workspace.root, 'features', changes, dryRun);
  }
  for (const [flag, name] of [
    [enable.clientNav, 'client-nav'],
    [enable.search, 'search'],
    [enable.contentNav, 'content-nav'],
  ] as const) {
    if (flag) {
      await adoptPackagedFeature(workspace.root, name, changes, notes, dryRun);
    }
  }
  if (workspace.layers.server) {
    await ensureBackendTsReference(workspace.root, changes, dryRun);
  }
  if (frontendConfig) {
    await ensureGithubPagesDeployScript(workspace.root, changes, dryRun);
    await ensureDeployScriptEntry(
      packageJsonPath,
      'bash ./utils/deploy-gh-pages.sh',
      changes,
      dryRun,
    );
    await ensureFrontendConfigBasePath(workspace.root, frontendConfig, changes, dryRun);
  }
  if (enable.s3CloudFront) {
    await ensureS3CloudFrontAssets(workspace.root, changes, dryRun);
    await ensureDeployScriptEntry(
      packageJsonPath,
      'bash ./utils/deploy-s3-cloudfront.sh',
      changes,
      dryRun,
    );
  }

  return {
    workspaceRoot: workspace.root,
    layers: workspace.layers,
    dryRun,
    restoreScaffold,
    changes: uniqueSorted(changes),
    // A migration may write a missing scaffold file itself (the hot-module move writes hmr.js).
    missingScaffold: restoreScaffold
      ? []
      : missingScaffold.filter((file) => !changes.includes(file)),
    notes,
  };
}

function getFixedRepairWriteTargets(
  workspaceRoot: string,
  layers: WorkspaceLayers,
  enable: RepairEnableFlags,
): readonly string[] {
  // Retiring old shape fields may rewrite package.json.
  const targets: string[] = [path.join(workspaceRoot, 'package.json')];
  const appRoot = path.join(workspaceRoot, 'src', 'frontend', 'app');

  // The hot-module migration may rewrite these even when neither is missing.
  if (layers.pages) {
    targets.push(path.join(appRoot, 'app.ts'), path.join(appRoot, 'hmr.js'));
  }
  if (enable.clientNav || enable.search || enable.contentNav) {
    targets.push(...appEntryPaths(workspaceRoot));
  }
  if (enable.clientNav) {
    targets.push(...legacyFeaturePaths(workspaceRoot, 'client-nav'));
  }
  if (enable.search) {
    targets.push(...legacyFeaturePaths(workspaceRoot, 'search'));
  }
  if (enable.contentNav) {
    targets.push(...legacyFeaturePaths(workspaceRoot, 'content-nav'));
  }
  if (enable.search || enable.contentNav) {
    targets.push(path.join(appRoot, 'app.css'));
  }
  if (enable.search) {
    targets.push(path.join(appRoot, 'app.html'));
  }
  if (layers.server) {
    targets.push(path.join(workspaceRoot, 'base.tsconfig.json'));
  }
  if (enable.githubPages) {
    targets.push(
      path.join(workspaceRoot, 'utils', 'deploy-gh-pages.sh'),
      path.join(workspaceRoot, 'package.json'),
      path.join(workspaceRoot, 'src', 'frontend', 'frontend.config.json'),
    );
  }
  if (enable.s3CloudFront) {
    targets.push(
      path.join(workspaceRoot, 'utils', 'deploy-s3-cloudfront.sh'),
      path.join(workspaceRoot, 'utils', 'cloudfront-rewrite-directory-index.js'),
      path.join(workspaceRoot, 'package.json'),
    );
  }

  return targets;
}

function noteRetiredRouter(workspaceRoot: string, notes: string[]): void {
  const present = RETIRED_ROUTER_FILES.filter((file) => existsSync(path.join(workspaceRoot, file)));
  if (present.length > 0) {
    notes.push(
      `The SPA router is retired (client-nav is the navigation): delete ${present.join(', ')} once nothing in the app imports them.`,
    );
  }
}

function filterStarterScaffoldAssets(
  assets: readonly { sourcePath: string; targetPath: string }[],
): readonly { sourcePath: string; targetPath: string }[] {
  // Starter tests belong to the app after init; deleted examples are not runtime drift.
  return assets.filter(
    (asset) => !normalizeRelativePath(asset.targetPath).split('/').includes('tests'),
  );
}

/**
 * Removes the fields older versions used to say what an app is (`webstir.mode`,
 * `webstir.enable.backend`); its files say it now, and a leftover field could only disagree.
 */
async function retireShapeFields(
  packageJsonPath: string,
  changes: string[],
  notes: string[],
  dryRun: boolean,
): Promise<void> {
  const root = JSON.parse(await readTextFile(packageJsonPath)) as Record<string, unknown>;
  const webstir = asRecord(root.webstir);
  const enable = asRecord(webstir.enable);
  const retired = [
    'mode' in webstir ? 'webstir.mode' : undefined,
    'backend' in enable ? 'webstir.enable.backend' : undefined,
  ].filter((field): field is string => field !== undefined);
  if (retired.length === 0) {
    return;
  }

  delete webstir.mode;
  delete enable.backend;
  if ('enable' in webstir) {
    webstir.enable = enable;
  }
  root.webstir = webstir;
  if (!dryRun) {
    await Bun.write(packageJsonPath, `${JSON.stringify(root, null, 2)}\n`);
  }
  changes.push(path.basename(packageJsonPath));
  notes.push(
    `Removed ${retired.join(' and ')} from package.json: an app's files say what it is (src/frontend for pages, src/backend/index.ts for a server).`,
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

// The hot-module registry moved from app.ts into the dev-only hmr.js, and the
// two only work as a pair: the current client reads window.__webstirHotModules,
// the older client read hooks the older app.ts installed. Repair moves both
// forward together when each is still the scaffold's own file, and otherwise
// leaves both alone and says why.
async function ensureHotModulePair(
  workspaceRoot: string,
  assets: readonly { sourcePath: string; targetPath: string }[],
  changes: string[],
  notes: string[],
  dryRun: boolean,
): Promise<void> {
  const appPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.ts');
  const clientPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'hmr.js');
  const clientAsset = assets.find(
    (asset) => normalizeRelativePath(asset.targetPath) === 'src/frontend/app/hmr.js',
  );
  if (!existsSync(appPath) || !clientAsset) {
    return;
  }

  const appRelative = relativeWorkspacePath(workspaceRoot, appPath);
  const clientRelative = relativeWorkspacePath(workspaceRoot, clientPath);
  const currentClient = await readTextFile(clientAsset.sourcePath);
  const appSource = await readTextFile(appPath);
  const migration = migrateHotModuleRegistry(appSource);
  const clientKind = existsSync(clientPath)
    ? classifyHmrClient(await readTextFile(clientPath), currentClient)
    : 'current';
  const manualSteps =
    'see "Moving an older workspace to the dev-only registry" in the webstir-frontend README';

  const refreshClient = async (): Promise<void> => {
    if (!dryRun) {
      await Bun.write(clientPath, currentClient);
    }
    changes.push(clientRelative);
  };

  if (migration.kind === 'customized') {
    notes.push(
      `${appRelative} still installs the old hot-update hooks, but ${migration.reason}; replace the registry block by hand (${manualSteps}), then run repair again.`,
    );
    return;
  }

  if (migration.kind === 'unchanged') {
    if (clientKind === 'legacy') {
      await refreshClient();
    } else if (clientKind === 'custom' && appSource.includes('__webstirHotModules')) {
      notes.push(
        `${clientRelative} is customized and may not read the registrations ${appRelative} queues in window.__webstirHotModules; compare it with the scaffold's client (${manualSteps}).`,
      );
    }
    return;
  }

  if (clientKind === 'custom') {
    notes.push(
      `${appRelative} still installs the old hot-update hooks, and ${clientRelative} is customized, so neither was changed; bring ${clientRelative} up to the scaffold's client and run repair again (${manualSteps}).`,
    );
    return;
  }

  // The registry moves into hmr.js, so the move writes its destination when it is missing too.
  if (clientKind === 'legacy' || !existsSync(clientPath)) {
    await refreshClient();
  }
  if (!dryRun) {
    await Bun.write(appPath, migration.source);
  }
  changes.push(appRelative);
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

async function ensureBackendTsReference(
  workspaceRoot: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const tsconfigPath = path.join(workspaceRoot, 'base.tsconfig.json');
  if (!existsSync(tsconfigPath) || (await solutionReferencesBackend(workspaceRoot))) {
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

// An app may keep its project references in tsconfig.json and use base.tsconfig.json only for
// shared compiler options; a backend referenced there needs nothing added to the base.
async function solutionReferencesBackend(workspaceRoot: string): Promise<boolean> {
  const solutionPath = path.join(workspaceRoot, 'tsconfig.json');
  if (!existsSync(solutionPath)) {
    return false;
  }
  const parsed = ts.parseConfigFileTextToJson(solutionPath, await readTextFile(solutionPath));
  const config = parsed.error ? undefined : parsed.config;
  const references = (config as { references?: unknown } | undefined)?.references;
  const backendPath = path.join(workspaceRoot, 'src', 'backend');
  return (
    Array.isArray(references) &&
    references.some((entry) => {
      const referencePath = (entry as { path?: unknown } | null)?.path;
      return (
        typeof referencePath === 'string' &&
        [backendPath, path.join(backendPath, 'tsconfig.json')].includes(
          path.resolve(workspaceRoot, referencePath),
        )
      );
    })
  );
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

async function ensureS3CloudFrontAssets(
  workspaceRoot: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const deployScriptPath = path.join(workspaceRoot, 'utils', 'deploy-s3-cloudfront.sh');
  if (!existsSync(deployScriptPath)) {
    if (!dryRun) {
      await mkdir(path.dirname(deployScriptPath), { recursive: true });
      await Bun.write(deployScriptPath, renderS3CloudFrontDeployScript());
      await chmod(deployScriptPath, 0o755);
    }
    changes.push(relativeWorkspacePath(workspaceRoot, deployScriptPath));
  }

  const functionPath = path.join(workspaceRoot, 'utils', 'cloudfront-rewrite-directory-index.js');
  if (!existsSync(functionPath)) {
    if (!dryRun) {
      await mkdir(path.dirname(functionPath), { recursive: true });
      await Bun.write(functionPath, renderS3CloudFrontFunction());
    }
    changes.push(relativeWorkspacePath(workspaceRoot, functionPath));
  }
}

async function ensureDeployScriptEntry(
  packageJsonPath: string,
  deployCommand: string,
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const source = await readTextFile(packageJsonPath);
  const root = JSON.parse(source) as RepairPackageJson & Record<string, unknown>;
  const scripts = root.scripts && typeof root.scripts === 'object' ? { ...root.scripts } : {};
  if (typeof scripts.deploy === 'string') {
    return;
  }

  scripts.deploy = deployCommand;
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

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
