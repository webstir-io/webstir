import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { findCssImportPaths } from './css-import-graph.ts';
import type { PackagedFeature } from './feature-imports.ts';
import { SCRIPT_EXTENSIONS, scriptSpecifiers, workspaceFiles } from './workspace-sources.ts';

/**
 * Files anywhere in the workspace (app code, tests, tooling) that would still use one of a
 * feature's copies once the app entry and app.css are rewritten (`rewritten` holds those new
 * contents). A relative import is resolved against the copies' paths; any other import ending in a
 * copy's name (a path alias) counts too, since it cannot be resolved here. An HTML file counts if
 * it names a copy's path at all. Dependencies, the workspace's build output and hidden folders are
 * skipped.
 */
export async function findCopyReferences(
  workspaceRoot: string,
  feature: PackagedFeature,
  rewritten: ReadonlyMap<string, string>,
): Promise<string[]> {
  const appRoot = path.join(workspaceRoot, 'src', 'frontend', 'app');
  const copies = new Set(feature.copies.map((copy) => withoutExtension(path.join(appRoot, copy))));
  const copyNames = feature.copies.map((copy) => path.basename(withoutExtension(copy)));

  const found: string[] = [];
  for (const filePath of await workspaceFiles(workspaceRoot)) {
    const extension = path.extname(filePath);
    if (copies.has(withoutExtension(filePath))) continue;
    const isScript = SCRIPT_EXTENSIONS.has(extension);
    if (!isScript && extension !== '.css' && extension !== '.html') continue;
    const text = rewritten.get(filePath) ?? (await readFile(filePath, 'utf8'));
    if (extension === '.html') {
      if (feature.copies.some((copy) => text.includes(withoutExtension(copy)))) {
        found.push(relativePath(workspaceRoot, filePath));
      }
      continue;
    }
    const specifiers = isScript ? scriptSpecifiers(text, filePath) : findCssImportPaths(text);
    const packaged = new Set([feature.script.packaged, feature.style?.packaged]);
    const usesCopy = specifiers.some((specifier) => {
      if (packaged.has(specifier)) return false;
      const bare = specifier.replace(/[?#].*$/, '');
      if (bare.startsWith('.')) {
        return copies.has(withoutExtension(path.resolve(path.dirname(filePath), bare)));
      }
      const name = path.basename(withoutExtension(bare));
      return copyNames.includes(name) && !/^[a-z][a-z0-9+.-]*:/i.test(specifier);
    });
    if (usesCopy) {
      found.push(relativePath(workspaceRoot, filePath));
    }
  }
  return found;
}

function relativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join('/');
}

function withoutExtension(filePath: string): string {
  return filePath.replace(/\.(?:[cm]?[jt]sx?|css)$/, '');
}
