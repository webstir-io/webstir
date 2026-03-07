import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const packageRoot = path.resolve(here, '..');
export const repoRoot = path.resolve(packageRoot, '..', '..');
