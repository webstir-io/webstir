import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/** What an app is made of, read from its files rather than declared. */
export interface WorkspaceLayers {
  /** The app has pages: a `src/frontend/` directory. */
  readonly pages: boolean;
  /** The app runs a server: its HTTP entry, `src/backend/index.{ts,tsx,js,mjs}`. */
  readonly server: boolean;
}

const SERVER_ENTRIES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs'];

export function readWorkspaceLayers(workspaceRoot: string): WorkspaceLayers {
  const root = path.resolve(workspaceRoot);
  return {
    pages: existsSync(path.join(root, 'src', 'frontend')),
    server: SERVER_ENTRIES.some((entry) => existsSync(path.join(root, 'src', 'backend', entry))),
  };
}

/**
 * Pages without a server publish as files any static host serves, and their views render at
 * publish.
 */
export function isStaticApp(layers: WorkspaceLayers): boolean {
  return layers.pages && !layers.server;
}

/**
 * Whether the app has backend code to compile: its server entry, or a function's or job's own
 * entry (`src/backend/functions/<name>/index.*`, `src/backend/jobs/<name>/index.*`). Functions and
 * jobs compile without a server, but are not one.
 */
export function hasBackendEntries(workspaceRoot: string): boolean {
  const backendRoot = path.join(path.resolve(workspaceRoot), 'src', 'backend');
  const hasIndex = (directory: string) =>
    SERVER_ENTRIES.some((entry) => existsSync(path.join(directory, entry)));
  if (hasIndex(backendRoot)) return true;
  return ['functions', 'jobs'].some((group) => {
    const groupRoot = path.join(backendRoot, group);
    if (!existsSync(groupRoot)) return false;
    return readdirSync(groupRoot, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && hasIndex(path.join(groupRoot, entry.name)),
    );
  });
}
