import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { SHIPPED_CLIENT_NAV_COPIES } from './client-nav-copies.ts';

export const CLIENT_NAV_PACKAGE_IMPORT = '@webstir-io/webstir-frontend/features/client-nav';
const LEGACY_CLIENT_NAV_IMPORT = './scripts/features/client-nav.js';
const LEGACY_FILES = Object.keys(SHIPPED_CLIENT_NAV_COPIES);

/** Where apps kept their copies of client-nav before it shipped in the frontend package. */
export function legacyClientNavPaths(workspaceRoot: string): readonly string[] {
  return LEGACY_FILES.map((name) =>
    path.join(workspaceRoot, 'src', 'frontend', 'app', 'scripts', 'features', name),
  );
}

/**
 * Points app.ts at the packaged client-nav and removes the copies Webstir used to write. A copy
 * that differs from every version Webstir shipped was changed by someone, so the app stays on its
 * local copies and a note says how to move over by hand.
 */
export async function adoptPackagedClientNav(
  workspaceRoot: string,
  changes: string[],
  notes: string[],
  dryRun = false,
): Promise<void> {
  const present = legacyClientNavPaths(workspaceRoot).filter((filePath) => existsSync(filePath));
  const edited: string[] = [];
  for (const filePath of present) {
    const digest = createHash('sha256')
      .update(await readFile(filePath))
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
    return;
  }

  for (const filePath of present) {
    if (!dryRun) {
      await rm(filePath);
    }
    changes.push(relativeWorkspacePath(workspaceRoot, filePath));
  }

  const appTsPath = path.join(workspaceRoot, 'src', 'frontend', 'app', 'app.ts');
  if (!existsSync(appTsPath)) {
    return;
  }
  const source = await readFile(appTsPath, 'utf8');
  const updated = usePackagedImport(source);
  if (updated === source) {
    return;
  }
  if (!dryRun) {
    await Bun.write(appTsPath, updated);
  }
  changes.push(relativeWorkspacePath(workspaceRoot, appTsPath));
}

/** Swaps the local client-nav import for the packaged one in place, or adds the packaged one. */
export function usePackagedImport(source: string): string {
  const packaged = sideEffectImportPattern(CLIENT_NAV_PACKAGE_IMPORT);
  const legacy = sideEffectImportPattern(LEGACY_CLIENT_NAV_IMPORT);
  if (packaged.test(source)) {
    return source.replace(legacy, '');
  }
  if (legacy.test(source)) {
    return source.replace(legacy, `import '${CLIENT_NAV_PACKAGE_IMPORT}';\n`);
  }
  const suffix = source.endsWith('\n') || source.length === 0 ? '' : '\n';
  return `${source}${suffix}import '${CLIENT_NAV_PACKAGE_IMPORT}';\n`;
}

function sideEffectImportPattern(specifier: string): RegExp {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`^[ \\t]*import\\s+(['"])${escaped}\\1[ \\t]*;?[ \\t]*(?:\\r?\\n|$)`, 'm');
}

function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
}
