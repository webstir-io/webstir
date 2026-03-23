import { startBunGeneratedFrontendWatch } from './bun-generated-frontend-watch.ts';
import type { DevServerAddress } from './dev-server.ts';

export interface BunSpaFrontendWatchOptions {
  readonly workspaceRoot: string;
  readonly host?: string;
  readonly port?: number;
}

export interface BunSpaFrontendWatchSession {
  readonly address: DevServerAddress;
  waitForExit(): Promise<number | null>;
  stop(): Promise<void>;
}

/**
 * Bun-first SPA watch assumptions:
 * - The workspace exposes a `src/frontend/app/app.html` shell and at least one
 *   page fragment under `src/frontend/pages`.
 * - Bun owns JavaScript/CSS dev serving and HMR through a generated full HTML
 *   entry document.
 * - HTML fragment edits regenerate the Bun entry document and trigger Bun's own
 *   route-level reload behavior instead of the legacy daemon protocol.
 */
export async function startBunSpaFrontendWatch(
  options: BunSpaFrontendWatchOptions,
): Promise<BunSpaFrontendWatchSession> {
  return await startBunGeneratedFrontendWatch(options);
}
