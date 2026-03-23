import { startBunBackend } from '@webstir-io/webstir-backend/runtime/bun';

import { resolveRequestAuth } from '../auth/adapter.js';
import { loadEnv, resolveWorkspaceRoot } from '../env.js';
import { createBaseLogger } from '../observability/logger.js';
import { createMetricsTracker } from '../observability/metrics.js';
import { sessionStore } from '../session/store.js';

export async function start(): Promise<void> {
  await startBunBackend({
    importMetaUrl: import.meta.url,
    moduleCandidates: [
      '../module.js',
      '../module.mjs',
      '../module/index.js',
      '../module/index.mjs',
    ],
    loadEnv,
    resolveWorkspaceRoot,
    resolveRequestAuth,
    createBaseLogger,
    createMetricsTracker,
    sessionStore,
  });
}

const isMain = (() => {
  try {
    const argv1 = process.argv?.[1];
    if (!argv1) return false;
    const here = new URL(import.meta.url);
    const run = new URL(`file://${argv1}`);
    return here.pathname === run.pathname;
  } catch {
    return false;
  }
})();

if (isMain) {
  start().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
