import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const entrypointPath = process.argv[1];
if (entrypointPath && path.resolve(entrypointPath) === fileURLToPath(import.meta.url)) {
  start().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
