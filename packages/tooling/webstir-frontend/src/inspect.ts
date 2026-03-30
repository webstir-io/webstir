import path from 'node:path';

import { FILES, FILE_NAMES } from './core/constants.js';
import { getPageDirectories } from './core/pages.js';
import { buildConfig } from './config/workspace.js';
import type {
  FrontendWorkspaceAppShellInspect,
  FrontendWorkspaceContentInspect,
  FrontendWorkspaceInspectResult,
  FrontendWorkspaceKnownEnableFlags,
  FrontendWorkspacePackageInspect,
  FrontendWorkspacePageInspect,
} from './types.js';
import { pathExists, readJson } from './utils/fs.js';

interface WorkspacePackageJson {
  readonly webstir?: {
    readonly mode?: string;
    readonly enable?: Record<string, unknown>;
  };
}

const PAGE_SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

export async function inspectFrontendWorkspace(
  workspaceRoot: string,
): Promise<FrontendWorkspaceInspectResult> {
  const config = buildConfig(workspaceRoot);
  const packageJson = await readWorkspacePackageInspect(workspaceRoot);
  const appShell = await inspectAppShell(config.paths.src.app);
  const pages = await inspectPages(config.paths.src.pages);
  const content = await inspectContent(config.paths.src.content);

  return {
    workspaceRoot,
    config,
    packageJson,
    appShell,
    pages,
    content,
  };
}

async function readWorkspacePackageInspect(
  workspaceRoot: string,
): Promise<FrontendWorkspacePackageInspect> {
  const packagePath = path.join(workspaceRoot, FILES.packageJson);
  const pkg = await readJson<WorkspacePackageJson>(packagePath);
  const enable = pkg?.webstir?.enable;

  return {
    path: packagePath,
    exists: pkg !== null,
    mode: pkg?.webstir?.mode,
    enable: {
      raw: enable,
      known: normalizeKnownEnableFlags(enable),
    },
  };
}

async function inspectAppShell(appRoot: string): Promise<FrontendWorkspaceAppShellInspect> {
  const templatePath = path.join(appRoot, FILE_NAMES.htmlAppTemplate);
  const stylesheetPath = path.join(appRoot, 'app.css');
  const scriptPath = await resolveFirstExistingPath(appRoot, 'app', PAGE_SCRIPT_EXTENSIONS);

  const [exists, templateExists, stylesheetExists, scriptExists] = await Promise.all([
    pathExists(appRoot),
    pathExists(templatePath),
    pathExists(stylesheetPath),
    pathExists(scriptPath),
  ]);

  return {
    root: appRoot,
    exists,
    templatePath,
    templateExists,
    stylesheetPath,
    stylesheetExists,
    scriptPath,
    scriptExists,
  };
}

async function inspectPages(pagesRoot: string): Promise<readonly FrontendWorkspacePageInspect[]> {
  const pages = await getPageDirectories(pagesRoot);
  return await Promise.all(
    pages.map(async (page) => {
      const htmlPath = path.join(page.directory, FILES.indexHtml);
      const stylesheetPath = path.join(page.directory, `${FILES.index}.css`);
      const scriptPath = await resolveFirstExistingPath(
        page.directory,
        FILES.index,
        PAGE_SCRIPT_EXTENSIONS,
      );

      const [htmlExists, stylesheetExists, scriptExists] = await Promise.all([
        pathExists(htmlPath),
        pathExists(stylesheetPath),
        pathExists(scriptPath),
      ]);

      return {
        name: page.name,
        directory: page.directory,
        htmlPath,
        htmlExists,
        stylesheetPath,
        stylesheetExists,
        scriptPath,
        scriptExists,
      };
    }),
  );
}

async function inspectContent(contentRoot: string): Promise<FrontendWorkspaceContentInspect> {
  const sidebarOverridePath = path.join(contentRoot, '_sidebar.json');
  const [exists, sidebarOverrideExists] = await Promise.all([
    pathExists(contentRoot),
    pathExists(sidebarOverridePath),
  ]);

  return {
    root: contentRoot,
    exists,
    sidebarOverridePath,
    sidebarOverrideExists,
  };
}

async function resolveFirstExistingPath(
  root: string,
  baseName: string,
  extensions: readonly string[],
): Promise<string> {
  for (const extension of extensions) {
    const candidate = path.join(root, `${baseName}${extension}`);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return path.join(root, `${baseName}${extensions[0] ?? ''}`);
}

function normalizeKnownEnableFlags(
  value: Record<string, unknown> | undefined,
): FrontendWorkspaceKnownEnableFlags {
  return {
    spa: value?.spa === true,
    clientNav: value?.clientNav === true,
    backend: value?.backend === true,
    search: value?.search === true,
    contentNav: value?.contentNav === true,
  };
}
