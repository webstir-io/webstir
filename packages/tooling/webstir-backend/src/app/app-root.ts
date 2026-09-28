import { resolveWorkspaceRoot } from '../workspace.js';

let configuredRoot: string | undefined;

/** The server sets the app's root when it starts; a job or script run on its own infers it. */
export function setAppRoot(workspaceRoot: string): void {
  configuredRoot = workspaceRoot;
}

export function appRoot(): string {
  return configuredRoot ?? resolveWorkspaceRoot();
}

export function isProduction(): boolean {
  return (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}
