import { checkUnrenderedBindings } from './render/unrendered-bindings.js';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

import type {
  ModuleArtifact,
  ModuleBuildOptions,
  ModuleBuildResult,
  ModuleDiagnostic,
  ModuleProvider,
  ResolvedModuleWorkspace,
} from '@webstir-io/module-contract';

import { runPipeline } from './pipeline.js';
import type { PipelineMode } from './pipeline.js';
import { prepareWorkspaceConfig } from './config/setup.js';
import type { FrontendConfig } from './types.js';
import { emptyDir, readJson } from './utils/fs.js';
import { scanGlob } from './utils/glob.js';
import { assertNoSsgRoutes, publishSsgSite } from './modes/ssg/index.js';
import { isStaticApp, readWorkspaceLayers } from '@webstir-io/module-contract/workspace';
import { validatePublishedHtml } from './html/publishValidation.js';

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly engines?: {
    readonly node?: string;
    readonly bun?: string;
  };
}

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as PackageJson;

function resolveWorkspacePaths(workspaceRoot: string): ResolvedModuleWorkspace {
  return {
    sourceRoot: path.join(workspaceRoot, 'src', 'frontend'),
    buildRoot: path.join(workspaceRoot, 'build', 'frontend'),
    testsRoot: path.join(workspaceRoot, 'src', 'frontend', 'tests'),
  };
}

async function buildModule(options: ModuleBuildOptions): Promise<ModuleBuildResult> {
  const config = await prepareWorkspaceConfig(options.workspaceRoot);
  const mode = normalizeMode(options.env?.WEBSTIR_MODULE_MODE);
  const workspace = await readWorkspaceFacts(options.workspaceRoot);
  // Pages without a server publish as files any static host serves.
  const shouldRunSsgPublish = mode === 'publish' && workspace.static;
  const publishConfig = shouldRunSsgPublish ? applySsgPublishLayout(config) : config;

  if (shouldRunSsgPublish) {
    await assertNoSsgRoutes(config.paths.workspace);
  }
  if (!options.incremental) {
    await emptyOutputRoot(publishConfig, mode);
  }
  await runPipeline(publishConfig, mode, {
    changedFile: undefined,
    enable: workspace.enable,
    env: {
      ...process.env,
      ...options.env,
    },
  });

  if (mode === 'build') {
    await checkUnrenderedBindings(options.workspaceRoot, config.paths.build.pages);
  }

  if (shouldRunSsgPublish) {
    await publishSsgSite(publishConfig);
  }
  if (mode === 'publish') {
    await validatePublishedHtml(publishConfig.paths.dist.frontend);
  }

  const artifacts = await collectArtifacts(config);
  const manifest = createManifest(config, artifacts, workspace.isSsg);

  return {
    artifacts,
    manifest,
  };
}

async function emptyOutputRoot(config: FrontendConfig, mode: PipelineMode): Promise<void> {
  const outputRoot = mode === 'publish' ? config.paths.dist.frontend : config.paths.build.frontend;
  await emptyDir(outputRoot);
}

function applySsgPublishLayout(config: FrontendConfig): FrontendConfig {
  const distFrontend = config.paths.dist.frontend;
  const distPages = distFrontend;
  const distContent = path.join(distFrontend, config.content.basePath.slice(1, -1));

  return {
    ...config,
    paths: {
      ...config.paths,
      dist: {
        ...config.paths.dist,
        pages: distPages,
        content: distContent,
      },
    },
  };
}

function normalizeMode(rawMode: unknown): PipelineMode {
  if (typeof rawMode !== 'string') {
    return 'build';
  }

  return rawMode.toLowerCase() === 'publish' ? 'publish' : 'build';
}

async function collectArtifacts(config: FrontendConfig): Promise<ModuleArtifact[]> {
  const buildRoot = config.paths.build.frontend;
  const matches = await scanGlob('**/*', {
    cwd: buildRoot,
    dot: false,
  });

  return matches.map<ModuleArtifact>((relative) => {
    const absolutePath = path.join(buildRoot, relative);
    const ext = path.extname(relative).toLowerCase();
    const artifactType = ext === '.js' || ext === '.mjs' ? 'bundle' : 'asset';

    return {
      path: absolutePath,
      type: artifactType,
    };
  });
}

interface WorkspaceEnableFlags {
  readonly clientNav?: boolean;
  readonly search?: boolean;
}

interface WorkspacePackageJson {
  readonly webstir?: {
    readonly mode?: string;
    readonly enable?: WorkspaceEnableFlags;
    readonly moduleManifest?: {
      readonly views?: ReadonlyArray<{
        readonly renderMode?: string;
      }>;
    };
  };
}

function createManifest(config: FrontendConfig, assets: readonly ModuleArtifact[], isSsg: boolean) {
  const entryPoints: string[] = [];
  const staticAssets: string[] = [];
  const diagnostics: ModuleDiagnostic[] = [];

  for (const asset of assets) {
    const relativePath = path.relative(config.paths.build.frontend, asset.path);
    const ext = path.extname(relativePath).toLowerCase();

    if (ext === '.js' || ext === '.mjs') {
      entryPoints.push(relativePath);
    } else if (ext) {
      staticAssets.push(relativePath);
    }
  }

  if (entryPoints.length === 0) {
    const fallback = path.join(config.paths.build.app, 'index.js');
    if (fs.existsSync(fallback)) {
      entryPoints.push(path.relative(config.paths.build.frontend, fallback));
    } else if (!isSsg) {
      diagnostics.push({
        severity: 'warn',
        message: 'No JavaScript entry points found under build/frontend.',
      });
    }
  }

  return {
    entryPoints,
    staticAssets,
    diagnostics,
  };
}

async function readWorkspaceFacts(
  workspaceRoot: string,
): Promise<{ static: boolean; isSsg: boolean; enable?: WorkspaceEnableFlags }> {
  const pkgPath = path.join(workspaceRoot, 'package.json');
  const pkg = await readJson<WorkspacePackageJson>(pkgPath);
  const views = pkg?.webstir?.moduleManifest?.views;
  const hasSsgView =
    Array.isArray(views) && views.some((view) => view.renderMode?.toLowerCase() === 'ssg');
  const isStatic = isStaticApp(readWorkspaceLayers(workspaceRoot));
  return {
    static: isStatic,
    isSsg: isStatic || hasSsgView,
    enable: pkg?.webstir?.enable,
  };
}

export const frontendProvider: ModuleProvider = {
  metadata: {
    id: pkg.name ?? '@webstir-io/webstir-frontend',
    kind: 'frontend',
    version: pkg.version ?? '0.0.0',
    compatibility: {
      minCliVersion: '0.1.0',
      nodeRange: pkg.engines?.node ?? '>=20.18.1',
      ...(pkg.engines?.bun ? { notes: `Requires Bun ${pkg.engines.bun} at runtime.` } : {}),
    },
  },
  resolveWorkspace(options) {
    return resolveWorkspacePaths(options.workspaceRoot);
  },
  async build(options) {
    return await buildModule(options);
  },
};
