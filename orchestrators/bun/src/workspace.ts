import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  hasBackendEntries,
  readWorkspaceLayers,
  type WorkspaceLayers,
} from '@webstir-io/module-contract/workspace';

import type { WorkspaceDescriptor } from './types.ts';

interface WorkspacePackageJson {
  readonly name?: string;
}

/** How output names an app's layers: `pages + server`, `pages`, or `server`. */
export function describeLayers(layers: WorkspaceLayers): string {
  return [layers.pages ? 'pages' : undefined, layers.server ? 'server' : undefined]
    .filter(Boolean)
    .join(' + ');
}
export async function readWorkspaceDescriptor(workspacePath: string): Promise<WorkspaceDescriptor> {
  const root = path.resolve(workspacePath);
  const packageJsonPath = path.join(root, 'package.json');

  let rawPackageJson: string;
  try {
    rawPackageJson = await readFile(packageJsonPath, 'utf8');
  } catch (error) {
    throw new Error(`Workspace package.json not found at ${packageJsonPath}.`, { cause: error });
  }

  let packageJson: WorkspacePackageJson;
  try {
    packageJson = JSON.parse(rawPackageJson) as WorkspacePackageJson;
  } catch (error) {
    throw new Error(`Workspace package.json at ${packageJsonPath} is not valid JSON.`, {
      cause: error,
    });
  }

  const layers = readWorkspaceLayers(root);
  const backendEntries = hasBackendEntries(root);
  if (!layers.pages && !backendEntries) {
    throw new Error(
      `${root} has no pages (src/frontend) and no server (src/backend/index.ts), so there is nothing to build.`,
    );
  }

  return {
    root,
    name: typeof packageJson.name === 'string' ? packageJson.name : path.basename(root),
    layers,
    backendEntries,
  };
}
