import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { packageRoot } from '../src/paths.ts';

// Drift that `webstir repair` migrates without --restore-scaffold, for tests that need a workspace
// doctor reports as unhealthy.

/** Puts back the hmr.js an older Webstir scaffolded; repair brings it up to the current client. */
export async function useLegacyHmrClient(workspaceRoot: string): Promise<string> {
  const clientPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'hmr.js');
  await writeFile(
    clientPath,
    await readFile(
      path.join(packageRoot, 'test-support', 'fixtures', 'legacy-hmr-client-spa.js.txt'),
      'utf8',
    ),
    'utf8',
  );
  return clientPath;
}

/** Drops the backend project reference; repair adds it back to base.tsconfig.json. */
export async function dropBackendReference(workspaceRoot: string): Promise<void> {
  const tsconfigPath = path.join(workspaceRoot, 'base.tsconfig.json');
  const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8')) as {
    references?: Array<{ path: string }>;
  };
  tsconfig.references = (tsconfig.references ?? []).filter(
    (reference) => reference.path !== 'src/backend',
  );
  await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
}
