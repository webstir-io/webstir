import path from 'node:path';
import { stat } from './fs.js';

export interface GlobScanOptions {
  readonly cwd: string;
  readonly absolute?: boolean;
  readonly dot?: boolean;
  readonly onlyFiles?: boolean;
}

export async function scanGlob(pattern: string, options: GlobScanOptions): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const matches = await Array.fromAsync(glob.scan(options));
  matches.sort((a, b) => a.localeCompare(b));
  return matches;
}

export async function scanDirectories(
  pattern: string,
  options: Omit<GlobScanOptions, 'onlyFiles'>,
): Promise<string[]> {
  const matches = await scanGlob(pattern, { ...options, onlyFiles: false });
  const directories = await Promise.all(
    matches.map(async (match) => {
      const absolutePath =
        options.absolute || path.isAbsolute(match) ? match : path.join(options.cwd, match);
      const info = await stat(absolutePath).catch(() => null);
      if (!info?.isDirectory()) {
        return null;
      }

      const normalized = match.replace(/[\\/]+$/, '');
      return normalized.length > 0 ? normalized : null;
    }),
  );

  return directories.filter((value): value is string => value !== null);
}
