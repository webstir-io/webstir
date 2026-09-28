import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDefaultBunBackendBootstrap, startBunBackend } from '@webstir-io/webstir-backend';

export async function start(): Promise<void> {
  await startBunBackend(createDefaultBunBackendBootstrap({ importMetaUrl: import.meta.url }));
}

const entrypointPath = process.argv[1];
if (entrypointPath && path.resolve(entrypointPath) === fileURLToPath(import.meta.url)) {
  start().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
