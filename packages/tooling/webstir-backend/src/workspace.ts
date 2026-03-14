import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ResolvedModuleWorkspace } from '@webstir-io/module-contract';

export type BackendBuildMode = 'build' | 'publish' | 'test';

interface ResolveWorkspaceRootOptions {
  readonly workspaceRoot?: string;
  readonly env?: Record<string, string | undefined>;
  readonly cwd?: string;
  readonly importMetaUrl?: string;
}

const WORKSPACE_ROOT_PATTERN = /^(.*)[/\\](?:src|build)[/\\]backend(?:[/\\].*)?$/;

export function resolveWorkspaceRoot(
  options?: string | ResolveWorkspaceRootOptions
): string {
  if (typeof options === 'string') {
    return path.resolve(options);
  }

  const explicitRoot = options?.workspaceRoot?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const env = options?.env ?? process.env;
  const envRoot = env.WORKSPACE_ROOT?.trim() || env.WEBSTIR_WORKSPACE_ROOT?.trim();
  if (envRoot) {
    return path.resolve(envRoot);
  }

  const inferredRoot = options?.importMetaUrl ? inferWorkspaceRootFromImportMetaUrl(options.importMetaUrl) : undefined;
  if (inferredRoot) {
    return inferredRoot;
  }

  return path.resolve(options?.cwd ?? process.cwd());
}

export function resolveWorkspacePaths(workspaceRoot: string): ResolvedModuleWorkspace {
  const resolvedWorkspaceRoot = resolveWorkspaceRoot(workspaceRoot);
  return {
    sourceRoot: path.join(resolvedWorkspaceRoot, 'src', 'backend'),
    buildRoot: path.join(resolvedWorkspaceRoot, 'build', 'backend'),
    testsRoot: path.join(resolvedWorkspaceRoot, 'src', 'backend', 'tests')
  };
}

export function normalizeMode(rawMode: unknown): BackendBuildMode {
  if (typeof rawMode !== 'string') {
    return 'build';
  }

  const normalized = rawMode.toLowerCase();
  return normalized === 'publish' || normalized === 'test' ? normalized : 'build';
}

function inferWorkspaceRootFromImportMetaUrl(importMetaUrl: string): string | undefined {
  try {
    return inferWorkspaceRootFromFilePath(fileURLToPath(importMetaUrl));
  } catch {
    return undefined;
  }
}

function inferWorkspaceRootFromFilePath(filePath: string): string | undefined {
  const normalizedFilePath = path.resolve(filePath);
  const match = normalizedFilePath.match(WORKSPACE_ROOT_PATTERN);
  if (!match) {
    return undefined;
  }

  const inferredRoot = match[1];
  return inferredRoot || path.parse(normalizedFilePath).root;
}
