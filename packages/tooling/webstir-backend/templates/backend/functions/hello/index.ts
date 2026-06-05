import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Example function entry (invoked by your runtime)
// This is a simple placeholder; wire it into your job/queue system as needed.

export async function run(): Promise<void> {
  // Do some background work here
  // e.g., send an email, process a small batch, etc.
  console.info('[function:hello] ran at', new Date().toISOString());
}

// Execute when launched directly: `bun build/backend/functions/hello/index.js`
const entrypointPath = process.argv[1];
if (entrypointPath && path.resolve(entrypointPath) === fileURLToPath(import.meta.url)) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
