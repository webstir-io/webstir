import { existsSync } from 'node:fs';
import path from 'node:path';

import { isStaticApp, readWorkspaceLayers } from '@webstir-io/module-contract/workspace';

import { validateRenderPrograms } from './validate.js';

// Where the backend looks for view loaders: module.* or module/index.*.
const MODULE_SOURCES = ['ts', 'tsx', 'js', 'mjs'].flatMap((extension) => [
  `module.${extension}`,
  `module/index.${extension}`,
]);

/**
 * A build of an app with no server and no view loaders already knows everything that could render
 * a page, so it fails on a page whose bindings nothing renders, as `webstir` does after it builds
 * an app's views. Other apps are checked by `webstir` once their views are built.
 */
export async function checkUnrenderedBindings(
  workspaceRoot: string,
  pagesRoot: string,
): Promise<void> {
  if (!isStaticApp(readWorkspaceLayers(workspaceRoot))) return;
  const backendRoot = path.join(workspaceRoot, 'src', 'backend');
  if (MODULE_SOURCES.some((file) => existsSync(path.join(backendRoot, file)))) return;
  await validateRenderPrograms({ workspaceRoot, pagesRoot });
}
