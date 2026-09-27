import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
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
  const stillReferenced = await findLegacyReferences(workspaceRoot, appTsPath, updated);
  if (present.length > 0 && stillReferenced.length > 0) {
    notes.push(
      `Kept the local client-nav copies because ${stillReferenced.join(', ')} still import them. ` +
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
 * Swaps the local client-nav import for the packaged one in place, or adds the packaged one. A
 * packaged import that is only in a comment does not count, and the file keeps its line endings.
 */
export function usePackagedImport(source: string): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const legacy = /import\s+(['"])\.\/scripts\/features\/client-nav\.js\1[ \t]*;?/;
  const packaged = new RegExp(
    `^[ \\t]*import\\s+(['"])${escapeRegExp(CLIENT_NAV_PACKAGE_IMPORT)}\\1`,
    'm',
  );
  if (packaged.test(withoutComments(source))) {
    return source.replace(new RegExp(`${legacy.source}[ \\t]*(?:\\r?\\n)?`, 'g'), '');
  }
  if (legacy.test(withoutComments(source))) {
    return source.replace(legacy, `import '${CLIENT_NAV_PACKAGE_IMPORT}';`);
  }
  const suffix = source.endsWith('\n') || source.length === 0 ? '' : newline;
  return `${source}${suffix}import '${CLIENT_NAV_PACKAGE_IMPORT}';${newline}`;
}

/** Block comments and whole-line comments, blanked so detection only sees code. */
export function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '');
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

const LEGACY_REFERENCE =
  /(['"])[^'"]*\/(?:client-nav|document-navigation|form-enhancement)(?:\.[cm]?[jt]sx?)?\1/;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts']);

/** Frontend source files that would still import a local copy after app.ts is rewritten. */
async function findLegacyReferences(
  workspaceRoot: string,
  appTsPath: string,
  rewrittenAppTs: string | undefined,
): Promise<string[]> {
  const legacyPaths = new Set(legacyClientNavPaths(workspaceRoot));
  const frontendRoot = path.join(workspaceRoot, 'src', 'frontend');
  if (!existsSync(frontendRoot)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of await readdir(frontendRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    if (legacyPaths.has(filePath)) continue;
    const text =
      filePath === appTsPath && rewrittenAppTs !== undefined
        ? rewrittenAppTs
        : await readFile(filePath, 'utf8');
    if (LEGACY_REFERENCE.test(text.split(CLIENT_NAV_PACKAGE_IMPORT).join(''))) {
      found.push(relativeWorkspacePath(workspaceRoot, filePath));
    }
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
}
