// Pages used to import the app's styles themselves (@import "@app/app.css"). The build links
// app.css on every page now, so repair takes that import out of each page stylesheet, leaving any
// import with a layer, media or supports condition for the app to move by hand.

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { relativeWorkspacePath } from './feature-imports.ts';

const PLAIN_IMPORT = /^[ \t]*@import\s+(["'])@app\/app\.css\1\s*;[ \t]*\r?\n?/gm;
const ANY_IMPORT = /@import\s+(?:url\(\s*)?["']?@app\/app\.css/;

export async function pageStylesheets(workspaceRoot: string): Promise<string[]> {
  const pages = path.join(workspaceRoot, 'src', 'frontend', 'pages');
  if (!existsSync(pages)) return [];
  return (await readdir(pages, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

export async function retirePageAppImports(
  workspaceRoot: string,
  changes: string[],
  notes: string[],
  dryRun: boolean,
): Promise<void> {
  const kept: string[] = [];
  for (const file of await pageStylesheets(workspaceRoot)) {
    const source = await readFile(file, 'utf8');
    if (!ANY_IMPORT.test(source)) continue;
    const updated = source.replace(PLAIN_IMPORT, '').replace(/^\s*\n/, '');
    if (ANY_IMPORT.test(updated)) kept.push(relativeWorkspacePath(workspaceRoot, file));
    if (updated === source) continue;
    if (!dryRun) await Bun.write(file, updated);
    changes.push(relativeWorkspacePath(workspaceRoot, file));
  }
  if (kept.length > 0) {
    notes.push(
      `${kept.join(', ')} still import @app/app.css with a condition. The build links app.css on every page now, so remove the import (or move its condition into app.css) to load the app's styles once.`,
    );
  }
}
