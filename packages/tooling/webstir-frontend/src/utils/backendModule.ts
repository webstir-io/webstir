import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathExists } from './fs.js';

export async function loadBackendModuleDefinition<T extends object>(
  workspaceRoot: string,
): Promise<T | undefined> {
  const buildRoot = path.join(workspaceRoot, 'build', 'backend');
  const candidates = [
    path.join(buildRoot, 'module.js'),
    path.join(buildRoot, 'module.mjs'),
    path.join(buildRoot, 'module', 'index.js'),
    path.join(buildRoot, 'module', 'index.mjs'),
  ];

  for (const fullPath of candidates) {
    if (!(await pathExists(fullPath))) {
      continue;
    }

    try {
      const imported = await importCurrent(fullPath);
      const candidate = extractModuleDefinition(imported);
      if (candidate) {
        return candidate as T;
      }
    } catch (error) {
      throw new Error(
        `[webstir-frontend] failed to import backend module definition from ${fullPath}: ${formatErrorMessage(error)}`,
      );
    }
  }

  return undefined;
}

const require = createRequire(import.meta.url);

/**
 * Imports the module as it is now, not as an earlier import cached it. Bun keeps ES modules in
 * `require.cache` and ignores a query string; Node does the opposite.
 */
async function importCurrent(fullPath: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(fullPath).href;
  if (!('Bun' in globalThis)) {
    return (await import(`${url}?t=${Date.now()}`)) as Record<string, unknown>;
  }
  for (const key of new Set([fullPath, await realpath(fullPath)])) {
    delete require.cache[key];
  }
  return (await import(url)) as Record<string, unknown>;
}

function extractModuleDefinition(exports: Record<string, unknown>): object | undefined {
  const keys = ['module', 'moduleDefinition', 'default', 'backendModule'];
  for (const key of keys) {
    if (key in exports) {
      const value = exports[key as keyof typeof exports];
      if (value && typeof value === 'object') {
        return value;
      }
    }
  }
  return undefined;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}
