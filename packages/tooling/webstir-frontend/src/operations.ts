import type { AddPageCommandOptions, EnableFlags, FrontendCommandOptions } from './types.js';
import { runPipeline } from './pipeline.js';
import { createPageScaffold, preflightPageScaffold } from './html/pageScaffold.js';
import { prepareWorkspaceConfig } from './config/setup.js';
import {
  assertNoSsgRoutes,
  ensureSsgViewMetadataForPage,
  publishSsgSite,
} from './modes/ssg/index.js';
import path from 'node:path';
import { isStaticApp, readWorkspaceLayers } from '@webstir-io/module-contract/workspace';
import { checkUnrenderedBindings } from './render/unrendered-bindings.js';
import { emptyDir, readJson } from './utils/fs.js';

export async function runBuild(options: FrontendCommandOptions): Promise<void> {
  const config = await prepareWorkspaceConfig(options.workspaceRoot);
  const enable = await readWorkspaceEnableFlags(options.workspaceRoot);
  console.info('[webstir-frontend] Running build pipeline...');
  if (!options.changedFile) {
    await emptyOutputRoot(config, 'build');
  }
  await runPipeline(config, 'build', {
    changedFile: options.changedFile,
    enable,
    env: process.env,
  });
  await checkUnrenderedBindings(options.workspaceRoot, config.paths.build.pages);
  console.info('[webstir-frontend] Build pipeline completed.');
}

export async function runPublish(options: FrontendCommandOptions): Promise<void> {
  const config = await prepareWorkspaceConfig(options.workspaceRoot);
  const enable = await readWorkspaceEnableFlags(options.workspaceRoot);
  // Pages without a server publish as files any static host serves.
  const staticSite = isStaticApp(readWorkspaceLayers(options.workspaceRoot));
  const publishConfig = staticSite ? applySsgPublishLayout(config) : config;
  const modeLabel = staticSite ? 'SSG publish' : 'publish';
  console.info(`[webstir-frontend] Running ${modeLabel} pipeline...`);

  if (staticSite) {
    await assertNoSsgRoutes(config.paths.workspace);
  }

  await emptyOutputRoot(publishConfig, 'publish');
  await runPipeline(publishConfig, 'publish', { enable, env: process.env });
  if (staticSite) {
    await publishSsgSite(publishConfig);
  }
  console.info(`[webstir-frontend] ${modeLabel} pipeline completed.`);
}

export async function runRebuild(options: FrontendCommandOptions): Promise<void> {
  const config = await prepareWorkspaceConfig(options.workspaceRoot);
  const enable = await readWorkspaceEnableFlags(options.workspaceRoot);
  console.info('[webstir-frontend] Running rebuild pipeline...');
  await runPipeline(config, 'build', {
    changedFile: options.changedFile,
    enable,
    env: process.env,
  });
  await checkUnrenderedBindings(options.workspaceRoot, config.paths.build.pages);
  console.info('[webstir-frontend] Rebuild pipeline completed.');
}

async function emptyOutputRoot(
  config: import('./types.js').FrontendConfig,
  mode: 'build' | 'publish',
): Promise<void> {
  const outputRoot = mode === 'publish' ? config.paths.dist.frontend : config.paths.build.frontend;
  await emptyDir(outputRoot);
}

export async function runAddPage(options: AddPageCommandOptions): Promise<void> {
  const { pageName } = await preflightPageScaffold({
    workspaceRoot: options.workspaceRoot,
    pageName: options.pageName,
  });
  // Malformed package metadata stops the scaffold before anything is written.
  await readJson(path.join(options.workspaceRoot, 'package.json'));
  const effectiveSsg = options.ssg ?? false;
  const config = await prepareWorkspaceConfig(options.workspaceRoot);
  console.info('[webstir-frontend] Creating page scaffold...');

  await createPageScaffold({
    workspaceRoot: options.workspaceRoot,
    pageName,
    mode: effectiveSsg || options.noScript ? 'ssg' : 'standard',
    paths: {
      pages: config.paths.src.pages,
      app: config.paths.src.app,
    },
  });
  if (effectiveSsg) {
    await ensureSsgViewMetadataForPage({
      workspaceRoot: options.workspaceRoot,
      pageName,
    });
  }
  console.info('[webstir-frontend] Page scaffold created.');
}

function applySsgPublishLayout(
  config: import('./types.js').FrontendConfig,
): import('./types.js').FrontendConfig {
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

interface WorkspacePackageJsonEnable {
  readonly webstir?: {
    readonly enable?: EnableFlags;
  };
}

async function readWorkspaceEnableFlags(workspaceRoot: string): Promise<EnableFlags | undefined> {
  const pkgPath = path.join(workspaceRoot, 'package.json');
  const pkg = await readJson<WorkspacePackageJsonEnable>(pkgPath);
  return pkg?.webstir?.enable;
}
