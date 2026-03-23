import path from 'node:path';
import { pathExists } from '../utils/fs.js';
import { scanDirectories } from '../utils/glob.js';

export interface PageInfo {
  readonly name: string;
  readonly directory: string;
}

export async function getPages(root: string): Promise<PageInfo[]> {
  const directories = await getPageDirectories(root);
  return directories.map((entry) => ({
    name: entry.name,
    directory: entry.directory,
  }));
}

export async function getPageDirectories(root: string): Promise<PageInfo[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await scanDirectories('*/', { cwd: root, absolute: false });
  return entries.map((entry) => {
    const name = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    return {
      name,
      directory: path.join(root, name),
    };
  });
}
