import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const COMPILED = /\.(?:ts|mts|js|mjs)$/;

/**
 * Brings build/backend/migrations in line with src/backend/migrations: `.sql` files copied as
 * written (the bundler compiles the rest), and a built migration whose source is gone removed.
 */
export async function syncMigrations(sourceRoot: string, buildRoot: string): Promise<void> {
  const source = path.join(sourceRoot, 'migrations');
  const built = path.join(buildRoot, 'migrations');
  const sources = existsSync(source) ? await readdir(source) : [];
  if (sources.length === 0) {
    await rm(built, { recursive: true, force: true });
    return;
  }
  await mkdir(built, { recursive: true });
  const ids = new Set<string>();
  for (const file of sources) {
    if (file.endsWith('.sql')) {
      await copyFile(path.join(source, file), path.join(built, file));
      ids.add(file);
    } else if (COMPILED.test(file) && !file.endsWith('.d.ts')) {
      ids.add(`${file.replace(COMPILED, '')}.js`);
    }
  }
  for (const file of await readdir(built)) {
    const kept = ids.has(file) || ids.has(file.replace(/\.map$/, ''));
    if (!kept) await rm(path.join(built, file), { force: true });
  }
}
