import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  SUPPORTED_WORKSPACE_MODES,
  type WorkspaceDescriptor,
  type WorkspaceMode,
} from './types.ts';

interface WorkspacePackageJson {
  readonly name?: string;
  readonly webstir?: {
    readonly mode?: string;
  };
}

export function parseWorkspaceMode(value: unknown): WorkspaceMode {
  if (typeof value !== 'string') {
    throw new Error('Workspace package.json is missing webstir.mode.');
  }

  const normalized = value.trim().toLowerCase();
  if (SUPPORTED_WORKSPACE_MODES.includes(normalized as WorkspaceMode)) {
    return normalized as WorkspaceMode;
  }

  throw new Error(
    `Unsupported webstir.mode "${value}". Expected one of: ${SUPPORTED_WORKSPACE_MODES.join(', ')}.`,
  );
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

  return {
    root,
    name: typeof packageJson.name === 'string' ? packageJson.name : path.basename(root),
    mode: parseWorkspaceMode(packageJson.webstir?.mode),
  };
}
