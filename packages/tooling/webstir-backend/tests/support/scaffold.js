import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scaffoldRoot = fileURLToPath(new URL('../fixtures/scaffold/', import.meta.url));

/** A backend to build in tests: the entry, a module, a function and a job. */
export function scaffoldAssets() {
  return [
    'tsconfig.json',
    'index.ts',
    'module.ts',
    path.join('functions', 'hello', 'index.ts'),
    path.join('jobs', 'nightly', 'index.ts'),
  ].map((relative) => ({
    sourcePath: path.join(scaffoldRoot, relative),
    targetPath: path.join('src', 'backend', relative),
  }));
}
