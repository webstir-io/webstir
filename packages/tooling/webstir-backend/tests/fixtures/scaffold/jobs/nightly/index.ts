import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A job. The server runs it on the schedule package.json gives it in `webstir.moduleManifest.jobs`,
// e.g. { "name": "nightly", "schedule": "0 0 * * *" }, or when code queues it with
// `jobs.enqueue('nightly', payload)`; `webstir jobs run nightly` runs it now.

export async function run(): Promise<void> {
  // Do some nightly maintenance work here
  console.info('[job:nightly] ran at', new Date().toISOString());
}

// Execute when launched directly: `bun build/backend/jobs/nightly/index.js`
const entrypointPath = process.argv[1];
if (entrypointPath && path.resolve(entrypointPath) === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
