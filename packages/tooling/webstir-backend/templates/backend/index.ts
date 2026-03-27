import { createDefaultBunBackendBootstrap, startBunBackend } from '@webstir-io/webstir-backend';

import { resolveRequestAuth } from './auth/adapter.js';
import { loadEnv } from './env.js';
import { createBaseLogger } from './observability/logger.js';
import { createMetricsTracker } from './observability/metrics.js';
import { sessionStore } from './session/store.js';

export async function start(): Promise<void> {
  await startBunBackend(
    createDefaultBunBackendBootstrap({
      importMetaUrl: import.meta.url,
      loadEnv,
      resolveRequestAuth,
      createBaseLogger,
      createMetricsTracker,
      sessionStore,
    }),
  );
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
