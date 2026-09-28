import path from 'node:path';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { getBackendScaffoldAssets } from '@webstir-io/webstir-backend';
import {
  pageScriptTemplate,
  renderGithubPagesDeployScript,
  renderGithubPagesWorkflow,
  renderS3CloudFrontDeployScript,
  renderS3CloudFrontFunction,
  renderS3CloudFrontWorkflow,
  type StaticFeatureAsset,
} from './enable-assets.ts';
import {
  adoptPackagedFeature,
  appEntryPaths,
  legacyFeaturePaths,
  type PackagedFeatureName,
} from './feature-imports.ts';
import { readWorkspaceDescriptor } from './workspace.ts';
import {
  assertNoExistingSymlinkComponents,
  normalizeScaffoldSegment,
  preflightScaffoldAssets,
  preflightWorkspaceWriteTargets,
} from './scaffold-path.ts';
import { readFrontendConfigDocument, type FrontendConfigDocument } from './frontend-config.ts';

type EnableFeature =
  | 'scripts'
  | 'client-nav'
  | 'search'
  | 'content-nav'
  | 'backend'
  | 'github-pages'
  | 'gh-pages'
  | 'gh-deploy'
  | 's3-cloudfront';

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
      'Missing enable feature. Usage: webstir enable <scripts <page>|client-nav|search|content-nav|backend|github-pages|gh-deploy|s3-cloudfront> --workspace <path>.',
    );
  }

  const feature = parseEnableFeature(featureToken);
  const changes: string[] = [];
  await preflightWorkspaceWriteTargets(
    workspace.root,
    getFixedEnableWriteTargets(workspace.root, feature),
    'write enable feature files',
  );

  switch (feature) {
    case 'scripts':
      await enableScripts(workspace.root, rest, changes);
      break;
    case 'client-nav':
      await enablePackagedFeature(workspace.root, 'client-nav', { enableClientNav: true }, changes);
      break;
    case 'search':
      await ensureAppCssFeaturesLayer(workspace.root, changes);
      await enablePackagedFeature(workspace.root, 'search', { enableSearch: true }, changes);
      break;
    case 'content-nav':
      await ensureAppCssFeaturesLayer(workspace.root, changes);
      await enablePackagedFeature(
        workspace.root,
        'content-nav',
        { enableContentNav: true },
        changes,
      );
      break;
    case 'backend':
      await enableBackend(workspace.root, changes);
      break;
    case 'github-pages':
    case 'gh-pages':
      await enableGithubPages(
        workspace.root,
        path.basename(workspace.root),
        rest[0],
        false,
        changes,
      );
      break;
    case 'gh-deploy':
      await enableGithubPages(
        workspace.root,
        path.basename(workspace.root),
        rest[0],
        true,
        changes,
      );
      break;
    case 's3-cloudfront':
      await enableS3CloudFront(workspace.root, changes);
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
  if ((normalized as string) === 'spa') {
    throw new Error(
      'The SPA router is gone: client-nav is how Webstir apps navigate. Run `webstir enable client-nav`.',
    );
  }
  switch (normalized) {
    case 'scripts':
    case 'client-nav':
    case 'search':
    case 'content-nav':
    case 'backend':
    case 'github-pages':
    case 'gh-pages':
    case 'gh-deploy':
    case 's3-cloudfront':
      return normalized;
    default:
      throw new Error(
        `Unknown feature "${value}". Expected scripts, client-nav, search, content-nav, backend, github-pages, gh-deploy, or s3-cloudfront.`,
      );
  }
}

function getFixedEnableWriteTargets(
  workspaceRoot: string,
  feature: EnableFeature,
): readonly string[] {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const appRoot = path.join(workspaceRoot, 'src', 'frontend', 'app');

  switch (feature) {
    case 'scripts':
      return [];
    case 'client-nav':
      return [
        ...appEntryPaths(workspaceRoot),
        packageJsonPath,
        ...legacyFeaturePaths(workspaceRoot, 'client-nav'),
      ];
    case 'search':
    case 'content-nav':
      return [
        path.join(appRoot, 'app.css'),
        ...appEntryPaths(workspaceRoot),
        packageJsonPath,
        ...legacyFeaturePaths(workspaceRoot, feature),
      ];
    case 'backend':
      return [packageJsonPath, path.join(workspaceRoot, 'base.tsconfig.json')];
    case 'github-pages':
    case 'gh-pages':
      return [
        path.join(workspaceRoot, 'utils', 'deploy-gh-pages.sh'),
        path.join(workspaceRoot, 'src', 'frontend', 'frontend.config.json'),
        packageJsonPath,
      ];
    case 'gh-deploy':
      return [
        path.join(workspaceRoot, 'utils', 'deploy-gh-pages.sh'),
        path.join(workspaceRoot, '.github', 'workflows', 'webstir-gh-pages.yml'),
        path.join(workspaceRoot, 'src', 'frontend', 'frontend.config.json'),
        packageJsonPath,
      ];
    case 's3-cloudfront':
      return [
        path.join(workspaceRoot, 'utils', 'deploy-s3-cloudfront.sh'),
        path.join(workspaceRoot, 'utils', 'cloudfront-rewrite-directory-index.js'),
        path.join(workspaceRoot, '.github', 'workflows', 'webstir-s3-cloudfront.yml'),
        packageJsonPath,
      ];
  }
}

async function enableScripts(
  workspaceRoot: string,
  args: readonly string[],
  changes: string[],
): Promise<void> {
  const rawPageName = args[0];
  if (!rawPageName) {
    throw new Error('Usage: webstir enable scripts <page> --workspace <path>.');
  }
  const pageName = normalizeScaffoldSegment(rawPageName, 'page');

  const pageDir = path.join(workspaceRoot, 'src', 'frontend', 'pages', pageName);
  const targetPath = path.join(pageDir, 'index.ts');
  await assertNoExistingSymlinkComponents(workspaceRoot, targetPath, 'write a page script');
  if (!existsSync(pageDir)) {
    throw new Error(`Page "${pageName}" does not exist. Create it first.`);
  }

  if (existsSync(targetPath)) {
    throw new Error(`Page "${pageName}" already has an index.ts script.`);
  }

  try {
    await writeFile(targetPath, pageScriptTemplate, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Page "${pageName}" already has an index.ts script.`, { cause: error });
    }
    throw error;
  }
  changes.push(relativeWorkspacePath(workspaceRoot, targetPath));
}

async function enableBackend(workspaceRoot: string, changes: string[]): Promise<void> {
  const backendRoot = path.join(workspaceRoot, 'src', 'backend');
  const assets = await preflightScaffoldAssets(
    workspaceRoot,
    await getBackendScaffoldAssets(),
    'write backend scaffold assets',
  );
  if (!existsSync(backendRoot)) {
    for (const asset of assets) {
      const { sourcePath, targetPath } = asset;
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Bun.write(targetPath, Bun.file(sourcePath));
      changes.push(asset.relativeTargetPath);
    }
  }

  await updatePackageJson(
    workspaceRoot,
    { enableBackend: true, ensureBackendDependency: true, mode: 'full' },
    changes,
  );
  await ensureTsReference(workspaceRoot, 'src/backend', changes);
}

async function enableGithubPages(
  workspaceRoot: string,
  workspaceName: string,
  basePathArg: string | undefined,
  includeWorkflow: boolean,
  changes: string[],
): Promise<void> {
  const resolvedBasePath = resolveGithubPagesBasePath(basePathArg, workspaceName);
  const frontendConfig = await readFrontendConfigDocument(workspaceRoot);
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

  await updateFrontendConfig(workspaceRoot, frontendConfig, resolvedBasePath, changes);
  await updatePackageJson(
    workspaceRoot,
    { enableGithubPages: true, ensureDeployScript: 'bash ./utils/deploy-gh-pages.sh' },
    changes,
  );
}

async function enableS3CloudFront(workspaceRoot: string, changes: string[]): Promise<void> {
  const deployScriptPath = path.join(workspaceRoot, 'utils', 'deploy-s3-cloudfront.sh');
  await writeTextFile(deployScriptPath, renderS3CloudFrontDeployScript(), 0o755);
  changes.push(relativeWorkspacePath(workspaceRoot, deployScriptPath));

  const functionPath = path.join(workspaceRoot, 'utils', 'cloudfront-rewrite-directory-index.js');
  await writeTextFile(functionPath, renderS3CloudFrontFunction());
  changes.push(relativeWorkspacePath(workspaceRoot, functionPath));

  const workflowPath = path.join(
    workspaceRoot,
    '.github',
    'workflows',
    'webstir-s3-cloudfront.yml',
  );
  if (!existsSync(workflowPath)) {
    await writeTextFile(workflowPath, renderS3CloudFrontWorkflow());
    changes.push(relativeWorkspacePath(workspaceRoot, workflowPath));
  }

  await updatePackageJson(
    workspaceRoot,
    { enableS3CloudFront: true, ensureDeployScript: 'bash ./utils/deploy-s3-cloudfront.sh' },
    changes,
  );
}

/**
 * Imports a feature from the frontend package, switching an app off copies older versions wrote.
 * Fails without setting the flag when the installed package cannot provide the feature.
 */
async function enablePackagedFeature(
  workspaceRoot: string,
  name: PackagedFeatureName,
  flags: Parameters<typeof updatePackageJson>[1],
  changes: string[],
): Promise<void> {
  const notes: string[] = [];
  const adoption = await adoptPackagedFeature(workspaceRoot, name, changes, notes);
  if (adoption === 'unavailable') {
    throw new Error(notes.join(' '));
  }
  for (const note of notes) console.warn(note);
  await updatePackageJson(workspaceRoot, flags, changes);
}

/** Feature stylesheets sit in the `features` cascade layer, so app.css's layer order needs it. */
async function ensureAppCssFeaturesLayer(workspaceRoot: string, changes: string[]): Promise<void> {
  const appCssPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.css');
  if (!existsSync(appCssPath)) {
    return;
  }
  const source = await readTextFile(appCssPath);
  const updated = ensureLayerIncludes(source, 'features');
  if (updated === source) {
    return;
  }
  await Bun.write(appCssPath, updated);
  changes.push(relativeWorkspacePath(workspaceRoot, appCssPath));
}

async function updatePackageJson(
  workspaceRoot: string,
  options: {
    readonly enableClientNav?: boolean;
    readonly enableSearch?: boolean;
    readonly enableContentNav?: boolean;
    readonly enableBackend?: boolean;
    readonly enableGithubPages?: boolean;
    readonly enableS3CloudFront?: boolean;
    readonly mode?: string;
    readonly ensureBackendDependency?: boolean;
    readonly ensureDeployScript?: string;
  },
  changes: string[],
): Promise<void> {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const source = await readTextFile(packageJsonPath);
  const root = JSON.parse(source) as Record<string, unknown>;
  const webstir = asRecord(root.webstir);
  const enable = asRecord(webstir.enable);

  if (options.mode) {
    webstir.mode = options.mode;
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
  if (options.enableS3CloudFront !== undefined) {
    enable.s3CloudFront = options.enableS3CloudFront;
  }

  webstir.enable = enable;
  root.webstir = webstir;

  if (options.ensureBackendDependency) {
    await ensureBackendScaffoldDependencies(root);
  }

  if (options.ensureDeployScript) {
    const scripts = asRecord(root.scripts);
    if (typeof scripts.deploy !== 'string') {
      scripts.deploy = options.ensureDeployScript;
    }
    root.scripts = scripts;
  }

  const updated = `${JSON.stringify(root, null, 2)}\n`;
  if (updated === source) {
    return;
  }

  await Bun.write(packageJsonPath, updated);
  changes.push(relativeWorkspacePath(workspaceRoot, packageJsonPath));
}

async function ensureBackendScaffoldDependencies(root: Record<string, unknown>): Promise<void> {
  const dependencies = asRecord(root.dependencies);
  if (typeof dependencies['@webstir-io/webstir-backend'] !== 'string') {
    dependencies['@webstir-io/webstir-backend'] = await resolveBackendDependencySpec(root);
  }
  if (typeof dependencies.pino !== 'string') {
    dependencies.pino = '^10.1.0';
  }
  root.dependencies = dependencies;

  const devDependencies = asRecord(root.devDependencies);
  if (typeof devDependencies['@types/bun'] !== 'string') {
    devDependencies['@types/bun'] = '^1.3.11';
  }
  root.devDependencies = devDependencies;
}

async function resolveBackendDependencySpec(root: Record<string, unknown>): Promise<string> {
  const dependencies = asRecord(root.dependencies);
  const frontendSpec = dependencies['@webstir-io/webstir-frontend'];
  if (typeof frontendSpec === 'string' && frontendSpec.startsWith('workspace:')) {
    return 'workspace:*';
  }

  return await readInstalledPackageVersion('@webstir-io/webstir-backend');
}

async function readInstalledPackageVersion(packageName: string): Promise<string> {
  const packageJsonUrl = import.meta.resolve(`${packageName}/package.json`);
  const packageJsonPath = fileURLToPath(packageJsonUrl);
  const packageJson = JSON.parse(await readTextFile(packageJsonPath)) as {
    readonly version?: string;
  };
  if (!packageJson.version) {
    throw new Error(`Missing version in ${packageJsonPath}`);
  }

  return `^${packageJson.version}`;
}

async function updateFrontendConfig(
  workspaceRoot: string,
  document: FrontendConfigDocument,
  basePath: string,
  changes: string[],
): Promise<void> {
  const publish = asRecord(document.root.publish);
  publish.basePath = basePath;
  document.root.publish = publish;

  const updated = `${JSON.stringify(document.root, null, 2)}\n`;
  if (document.source === updated) {
    return;
  }

  await writeTextFile(document.filePath, updated);
  changes.push(relativeWorkspacePath(workspaceRoot, document.filePath));
}

async function ensureTsReference(
  workspaceRoot: string,
  referencePath: string,
  changes: string[],
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
      (entry as Record<string, unknown>).path === referencePath,
  );
  if (!exists) {
    references.push({ path: referencePath });
  }
  root.references = references;

  const updated = `${JSON.stringify(root, null, 2)}\n`;
  if (updated === source) {
    return;
  }

  await Bun.write(tsconfigPath, updated);
  changes.push(relativeWorkspacePath(workspaceRoot, tsconfigPath));
}

function resolveGithubPagesBasePath(
  basePathArg: string | undefined,
  workspaceName: string,
): string {
  const candidate = (basePathArg ?? workspaceName).trim();
  if (!candidate || candidate === '/') {
    return '/';
  }

  const withLeadingSlash = candidate.startsWith('/') ? candidate : `/${candidate}`;
  return withLeadingSlash.length > 1 && withLeadingSlash.endsWith('/')
    ? withLeadingSlash.slice(0, -1)
    : withLeadingSlash;
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

async function writeTextFile(filePath: string, contents: string, mode?: number): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await Bun.write(filePath, contents);
  if (mode !== undefined) {
    await chmod(filePath, mode);
  }
}

async function readTextFile(filePath: string): Promise<string> {
  return await Bun.file(filePath).text();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replaceAll(path.sep, '/');
}
