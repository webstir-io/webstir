import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const packageRoot = path.resolve(here, '..');
export const assetsRoot = path.join(packageRoot, 'assets');

export const monorepoRoot = resolveMonorepoRoot();
export const repoRoot = monorepoRoot ?? path.resolve(packageRoot, '..', '..');

function resolveMonorepoRoot(): string | null {
  const candidate = path.resolve(packageRoot, '..', '..');
  const packageJsonPath = path.join(candidate, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
    return packageJson.name === 'webstir' ? candidate : null;
  } catch {
    return null;
  }
}
