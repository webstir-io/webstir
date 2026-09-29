// The app entry older scaffolds wrote was Webstir's own: a hot-module registry, a loader for the
// error reporter, and feature imports. The package does each of those now, so repair takes the
// scaffold's blocks out of app.ts, deletes app.ts when nothing of the app's own is left, and
// deletes the error reporter it loaded. It changes only exact scaffold text, and only while no
// other source imports from app.ts.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { appEntryPaths, relativeWorkspacePath, scanImports } from './feature-imports.ts';
import { HOT_MODULE_REGISTRATION, migrateHotModuleRegistry } from './hot-module-migration.ts';

const HEADER = '// Global app initialization\n';
const errorLoader = (specifier: string) => `// Lazy-load error handler on first error
let errorHandlerLoaded = false;

async function loadErrorHandler() {
  if (errorHandlerLoaded) return;
  errorHandlerLoaded = true;

  try {
    const { install } = await import('${specifier}');
    install();
  } catch (e) {
    console.error('Failed to load error handler:', e);
  }
}

// Set up error listeners that will dynamically import the error handler
window.addEventListener('error', async () => {
  await loadErrorHandler();
  // The installed handler will catch subsequent errors
});

window.addEventListener('unhandledrejection', async () => {
  await loadErrorHandler();
  // The installed handler will catch subsequent rejections
});

// Export for use by pages if needed
export { loadErrorHandler };
`;
// Scaffolds imported the reporter as './error' and, earlier, as './error.js'.
const ERROR_LOADERS = [errorLoader('./error'), errorLoader('./error.js')];
const loadsErrorReporter = (source: string) =>
  /import\(\s*['"]\.\/error(\.js)?['"]\s*\)/.test(source);
// SHA-256 (with LF line endings) of the error.ts every scaffold wrote.
const SHIPPED_ERROR_REPORTERS = new Set([
  '613b4efbaa3ec867550d6b73da1779033d66a15fbdab85a62e3db5949405d432',
]);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs']);

export type EntryRetirement =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rewritten'; readonly source: string }
  | { readonly kind: 'removed' };

/** app.ts without the scaffold's blocks, or removed when nothing of the app's own is left. */
export function retireScaffoldEntry(source: string): EntryRetirement {
  const migrated = migrateHotModuleRegistry(source);
  const current = (migrated.kind === 'rewritten' ? migrated.source : source).replace(/\r\n/g, '\n');
  const remaining = ERROR_LOADERS.reduce(
    (text, loader) => text.replace(loader, ''),
    withoutRegistration(current),
  );
  if (remaining === current) return { kind: 'unchanged' };
  const withoutHeader = remaining.replace(HEADER, (header, at: number) =>
    at === 0 || remaining.slice(at + header.length).trim() === '' ? '' : header,
  );
  const rest = withoutHeader.replace(/^\s*\n/, '').replace(/\n\s*$/, '\n');
  if (rest.trim() === '') return { kind: 'removed' };
  return { kind: 'rewritten', source: rest };
}

// The scaffold wrote the registry with a blank line after it, except at the end of the file.
function withoutRegistration(source: string): string {
  if (source.includes(HOT_MODULE_REGISTRATION)) return source.replace(HOT_MODULE_REGISTRATION, '');
  const last = `${HOT_MODULE_REGISTRATION.trimEnd()}\n`;
  return source.endsWith(last) ? source.slice(0, -last.length) : source;
}

export async function retireScaffoldAppFiles(
  workspaceRoot: string,
  changes: string[],
  notes: string[],
  dryRun: boolean,
): Promise<void> {
  const appRoot = path.join(workspaceRoot, 'src', 'frontend', 'app');
  const entryPath = appEntryPaths(workspaceRoot).find((candidate) => existsSync(candidate));
  const errorPath = path.join(appRoot, 'error.ts');
  let errorReporterLoaded = false;

  if (entryPath) {
    const entryName = relativeWorkspacePath(workspaceRoot, entryPath);
    const source = await readFile(entryPath, 'utf8');
    errorReporterLoaded = loadsErrorReporter(source);
    const retirement = retireScaffoldEntry(source);
    if (retirement.kind !== 'unchanged') {
      const importers = await findEntryImporters(workspaceRoot, entryPath);
      if (importers.length > 0) {
        notes.push(
          `${entryName} still holds the scaffold's hot-module registry and error loader, because ${importers.join(', ')} import from it. ` +
            "Import registerHotModule from '@webstir-io/webstir-frontend/runtime' instead, then run repair again.",
        );
        return;
      }
      if (!dryRun) {
        if (retirement.kind === 'removed') await rm(entryPath);
        else await Bun.write(entryPath, retirement.source);
      }
      changes.push(entryName);
      errorReporterLoaded =
        retirement.kind === 'rewritten' && loadsErrorReporter(retirement.source);
    }
  }

  if (!existsSync(errorPath) || errorReporterLoaded) return;
  const errorName = relativeWorkspacePath(workspaceRoot, errorPath);
  const digest = createHash('sha256')
    .update((await readFile(errorPath, 'utf8')).replace(/\r\n/g, '\n'))
    .digest('hex');
  if (SHIPPED_ERROR_REPORTERS.has(digest)) {
    if (!dryRun) await rm(errorPath);
    changes.push(errorName);
  } else {
    notes.push(
      `${errorName} is no longer used: Webstir reports browser errors itself (webstir.enable.clientErrors turns it off). Delete it once nothing you changed in it is needed.`,
    );
  }
}

/** Frontend sources that import the app entry, relative to the workspace. */
async function findEntryImporters(workspaceRoot: string, entryPath: string): Promise<string[]> {
  const frontend = path.join(workspaceRoot, 'src', 'frontend');
  const entryStem = entryPath.slice(0, -path.extname(entryPath).length);
  const found: string[] = [];
  for (const entry of await readdir(frontend, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (file === entryPath) continue;
    let imports: string[];
    try {
      imports = scanImports(await readFile(file, 'utf8'), file);
    } catch {
      continue;
    }
    const importsEntry = imports.some((specifier) => {
      if (!specifier.startsWith('.')) return false;
      const target = path.resolve(path.dirname(file), specifier);
      return target === entryStem || target.replace(/\.[cm]?[jt]sx?$/, '') === entryStem;
    });
    if (importsEntry) found.push(relativeWorkspacePath(workspaceRoot, file));
  }
  return found;
}
