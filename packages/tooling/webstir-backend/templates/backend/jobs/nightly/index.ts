import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Example job entry (scheduled by your orchestrator)
// Update `webstir.moduleManifest.jobs` in package.json to point to this job with a schedule, e.g.:
// { "name": "nightly", "schedule": "0 0 * * *", "description": "Nightly maintenance" }

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
