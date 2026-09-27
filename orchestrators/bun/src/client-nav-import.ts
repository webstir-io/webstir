import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from '@typescript/typescript6';
import path from 'node:path';

import { SHIPPED_CLIENT_NAV_COPIES } from './client-nav-copies.ts';

export const CLIENT_NAV_PACKAGE_IMPORT = '@webstir-io/webstir-frontend/features/client-nav';
const LEGACY_FILES = Object.keys(SHIPPED_CLIENT_NAV_COPIES);

/** Where apps kept their copies of client-nav before it shipped in the frontend package. */
export function legacyClientNavPaths(workspaceRoot: string): readonly string[] {
  return LEGACY_FILES.map((name) =>
    path.join(workspaceRoot, 'src', 'frontend', 'app', 'scripts', 'features', name),
  );
}

export type ClientNavAdoption = 'packaged' | 'kept-local' | 'unavailable';

/**
 * Points app.ts at the packaged client-nav and removes the copies Webstir used to write. Nothing
 * is removed unless the switch is complete and safe: every copy matches a version Webstir shipped,
 * the app's installed frontend package exports the feature, and no source still refers to a copy
 * once app.ts is rewritten. Otherwise the app keeps working as it is and a note says why.
 */
export async function adoptPackagedClientNav(
  workspaceRoot: string,
  changes: string[],
  notes: string[],
  dryRun = false,
): Promise<ClientNavAdoption> {
  const present = legacyClientNavPaths(workspaceRoot).filter((filePath) => existsSync(filePath));
  const edited: string[] = [];
  for (const filePath of present) {
    // A Windows checkout of a shipped copy differs only in line endings.
    const digest = createHash('sha256')
      .update((await readFile(filePath, 'utf8')).replaceAll('\r\n', '\n'))
      .digest('hex');
    if (!SHIPPED_CLIENT_NAV_COPIES[path.basename(filePath)]?.has(digest)) {
      edited.push(relativeWorkspacePath(workspaceRoot, filePath));
    }
  }
  if (edited.length > 0) {
    notes.push(
      `Kept the local client-nav copies because ${edited.join(', ')} differ from what Webstir shipped. ` +
        `To use the packaged version, move your changes elsewhere, delete src/frontend/app/scripts/features/{${LEGACY_FILES.join(',')}}, ` +
        `and import '${CLIENT_NAV_PACKAGE_IMPORT}' in src/frontend/app/app.ts.`,
    );
    return 'kept-local';
  }

  if (!installedFrontendShipsClientNav(workspaceRoot)) {
    notes.push(
      `The installed @webstir-io/webstir-frontend does not ship '${CLIENT_NAV_PACKAGE_IMPORT}'. ` +
        'Upgrade it to 0.3.0 or newer, then run this command again.' +
        (present.length > 0 ? ' The local client-nav copies were left in place.' : ''),
    );
    return 'unavailable';
  }

  const appTsPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.ts');
  const source = existsSync(appTsPath) ? await readFile(appTsPath, 'utf8') : undefined;
  const updated = source === undefined ? undefined : usePackagedImport(source);
  // The rewrite is only kept when parsing it shows the packaged import and no local one.
  if (updated !== undefined && !importsPackagedOnly(updated, appTsPath)) {
    notes.push(
      `Kept the local client-nav copies because src/frontend/app/app.ts could not be switched automatically. ` +
        `Replace its import of './scripts/features/client-nav.js' with '${CLIENT_NAV_PACKAGE_IMPORT}', then run this command again.`,
    );
    return 'kept-local';
  }
  const stillReferenced = await findLegacyReferences(workspaceRoot, appTsPath, updated);
  if (present.length > 0 && stillReferenced.length > 0) {
    notes.push(
      `Kept the local client-nav copies because ${stillReferenced.join(', ')} still use them. ` +
        `Point those imports at '${CLIENT_NAV_PACKAGE_IMPORT}' or remove them, then run this command again.`,
    );
    return 'kept-local';
  }

  if (source !== undefined && updated !== undefined && updated !== source) {
    if (!dryRun) {
      await Bun.write(appTsPath, updated);
    }
    changes.push(relativeWorkspacePath(workspaceRoot, appTsPath));
  }
  for (const filePath of present) {
    if (!dryRun) {
      await rm(filePath);
    }
    changes.push(relativeWorkspacePath(workspaceRoot, filePath));
  }
  return 'packaged';
}

/**
 * Swaps the local client-nav import for the packaged one in place, or adds the packaged one.
 * Only whole import statements at the start of a line change, so comments and the lines around
 * them stay as they are; the file keeps its line endings. Callers confirm the result by parsing it.
 */
export function usePackagedImport(source: string): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const legacyStatement =
    /^([ \t]*)import\s+(['"])\.\/scripts\/features\/client-nav\.js\2[ \t]*;?/m;
  let imports: string[];
  try {
    imports = scanImports(source, 'app.ts');
  } catch {
    return source;
  }
  if (imports.includes(CLIENT_NAV_PACKAGE_IMPORT)) {
    const wholeLine = new RegExp(
      `${legacyStatement.source}[ \\t]*(?:\\/\\/[^\\r\\n]*)?(?:\\r?\\n|$)`,
      'gm',
    );
    return source.replace(wholeLine, '');
  }
  if (imports.includes(LEGACY_IMPORT)) {
    return source.replace(legacyStatement, `$1import '${CLIENT_NAV_PACKAGE_IMPORT}';`);
  }
  const suffix = source.endsWith('\n') || source.length === 0 ? '' : newline;
  return `${source}${suffix}import '${CLIENT_NAV_PACKAGE_IMPORT}';${newline}`;
}

const LEGACY_IMPORT = './scripts/features/client-nav.js';

function importsPackagedOnly(source: string, filePath: string): boolean {
  try {
    const imports = scanImports(source, filePath);
    return imports.includes(CLIENT_NAV_PACKAGE_IMPORT) && !imports.includes(LEGACY_IMPORT);
  } catch {
    return false;
  }
}

/**
 * The modules a file loads when it runs, parsed by Bun so comments and strings never count. Only
 * static imports: a dynamic import() does not start client-nav with the page.
 */
export function scanImports(source: string, filePath: string): string[] {
  const extension = path.extname(filePath).slice(1);
  const loader =
    extension === 'tsx' || extension === 'jsx' || extension === 'js' ? extension : 'ts';
  return new Bun.Transpiler({ loader })
    .scanImports(source)
    .filter((entry) => entry.kind === 'import-statement')
    .map((entry) => entry.path);
}

/** Whether the frontend package this app resolves exports the client-nav feature. */
function installedFrontendShipsClientNav(workspaceRoot: string): boolean {
  try {
    const require = createRequire(path.join(workspaceRoot, 'package.json'));
    const manifestPath = require.resolve('@webstir-io/webstir-frontend/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    return Boolean(manifest.exports?.['./features/client-nav']);
  } catch {
    return false;
  }
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts']);
const COPY_NAME = /(?:^|\/)(?:client-nav|document-navigation|form-enhancement)(?:\.[cm]?[jt]sx?)?$/;

/**
 * Frontend source files that would still use a local copy once app.ts is rewritten. TypeScript
 * lists every import a file makes (static, dynamic, type-only and re-exports), never comments or
 * strings. A relative import is resolved against the copies' paths; any other import that ends in
 * a copy's name (a path alias) counts too, since it cannot be resolved here.
 */
async function findLegacyReferences(
  workspaceRoot: string,
  appTsPath: string,
  rewrittenAppTs: string | undefined,
): Promise<string[]> {
  const legacyPaths = new Set(legacyClientNavPaths(workspaceRoot).map(withoutExtension));
  const frontendRoot = path.join(workspaceRoot, 'src', 'frontend');
  if (!existsSync(frontendRoot)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of await readdir(frontendRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    if (legacyPaths.has(withoutExtension(filePath))) continue;
    const text =
      filePath === appTsPath && rewrittenAppTs !== undefined
        ? rewrittenAppTs
        : await readFile(filePath, 'utf8');
    const usesCopy = ts
      .preProcessFile(text, true, true)
      .importedFiles.map((imported) => imported.fileName)
      .some((specifier) =>
        specifier.startsWith('.')
          ? legacyPaths.has(withoutExtension(path.resolve(path.dirname(filePath), specifier)))
          : specifier !== CLIENT_NAV_PACKAGE_IMPORT && COPY_NAME.test(specifier),
      );
    if (usesCopy) {
      found.push(relativeWorkspacePath(workspaceRoot, filePath));
    }
  }
  return found;
}

function withoutExtension(filePath: string): string {
  return filePath.replace(/\.[cm]?[jt]sx?$/, '');
}

function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
}
