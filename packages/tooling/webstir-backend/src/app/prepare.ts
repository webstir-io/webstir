import { setAppRoot } from './app-root.js';
import { loadEnvFiles } from './env.js';

/**
 * Points the batteries at an app from outside its server, as a CLI command or a script does: its
 * root, and the settings in its `.env` files.
 */
export function prepareApp(workspaceRoot: string): void {
  setAppRoot(workspaceRoot);
  // The app's jobs may import their own copy of this package; it finds the app the same way.
  process.env.WEBSTIR_WORKSPACE_ROOT = workspaceRoot;
  loadEnvFiles(workspaceRoot);
}
