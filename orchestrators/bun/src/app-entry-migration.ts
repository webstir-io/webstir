// The app entry older scaffolds wrote was Webstir's own: a hot-module registry, a loader for the
// error reporter, and feature imports. The package does each of those now, so repair takes the
// scaffold's blocks out of app.ts, deletes app.ts when nothing of the app's own is left, and
// deletes the error reporter it loaded. It changes only exact scaffold text, and only while no
// other source imports from app.ts.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { appEntryPaths, relativeWorkspacePath } from './feature-imports.ts';
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
// Any import of the reporter, static or dynamic.
const loadsErrorReporter = (source: string) => /['"]\.\/error(\.[jt]s)?['"]/.test(source);
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

  // What each page script will say once repair is done, for the checks below to read.
  const pageSources = new Map<string, string>();
  if (entryPath) {
    // Pages that add-page wrote before 0.8 load app.ts themselves, which the app bundle now loads
    // on every page; that line would run it twice.
    for (const file of await pageScripts(workspaceRoot)) {
      const source = await readFile(file, 'utf8');
      const updated = withoutAppEntryImport(source, file, entryPath);
      if (updated === source) continue;
      pageSources.set(file, updated);
      if (!dryRun) await Bun.write(file, updated);
      changes.push(relativeWorkspacePath(workspaceRoot, file));
    }

    const entryName = relativeWorkspacePath(workspaceRoot, entryPath);
    const source = await readFile(entryPath, 'utf8');
    errorReporterLoaded = loadsErrorReporter(source);
    const retirement = retireScaffoldEntry(source);
    if (retirement.kind !== 'unchanged') {
      const importers = await findImporters(workspaceRoot, entryPath, [entryPath], pageSources);
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
  const errorImporters = await findImporters(
    workspaceRoot,
    errorPath,
    entryPath ? [entryPath, errorPath] : [errorPath],
    pageSources,
  );
  if (errorImporters.length > 0) {
    notes.push(
      `${errorName} is no longer needed, Webstir reports browser errors itself, but ${errorImporters.join(', ')} import it. Remove those imports, then delete it.`,
    );
    return;
  }
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

/** Frontend sources, other than those skipped, that import a module, relative to the workspace. */
async function findImporters(
  workspaceRoot: string,
  modulePath: string,
  skip: readonly string[],
  sources: ReadonlyMap<string, string>,
): Promise<string[]> {
  const frontend = path.join(workspaceRoot, 'src', 'frontend');
  const stem = modulePath.slice(0, -path.extname(modulePath).length);
  const found: string[] = [];
  for (const entry of await readdir(frontend, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const file = path.join(entry.parentPath, entry.name);
    if (skip.includes(file)) continue;
    const imports = scanAllImports(sources.get(file) ?? (await readFile(file, 'utf8')), file);
    const importsModule = imports.some((specifier) => {
      if (!specifier.startsWith('.')) return false;
      const target = path.resolve(path.dirname(file), specifier);
      return target === stem || target.replace(/\.[cm]?[jt]sx?$/, '') === stem;
    });
    if (importsModule) found.push(relativeWorkspacePath(workspaceRoot, file));
  }
  return found;
}

/** The app's page scripts, which repair may rewrite. */
export async function pageScripts(workspaceRoot: string): Promise<string[]> {
  const pages = path.join(workspaceRoot, 'src', 'frontend', 'pages');
  if (!existsSync(pages)) return [];
  return (await readdir(pages, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name)))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** A page script without its bare `import '../../app/app';`, the line add-page wrote before 0.8. */
function withoutAppEntryImport(source: string, file: string, entryPath: string): string {
  const entryStem = entryPath.slice(0, -path.extname(entryPath).length);
  return source.replace(
    /^[ \t]*import\s+(['"])(\.{1,2}\/[^'"]*)\1[ \t]*;?[ \t]*(?:\r?\n|$)/gm,
    (line, _quote: string, specifier: string) => {
      const target = path.resolve(path.dirname(file), specifier).replace(/\.[cm]?[jt]sx?$/, '');
      return target === entryStem ? '' : line;
    },
  );
}

// Static and dynamic imports alike: either one still needs the module.
function scanAllImports(source: string, filePath: string): string[] {
  const extension = path.extname(filePath).slice(1);
  const loader =
    extension === 'tsx' || extension === 'jsx' || extension === 'js' ? extension : 'ts';
  try {
    return new Bun.Transpiler({ loader }).scanImports(source).map((entry) => entry.path);
  } catch {
    return [];
  }
}
