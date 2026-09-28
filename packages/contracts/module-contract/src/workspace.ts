import { existsSync } from 'node:fs';
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
