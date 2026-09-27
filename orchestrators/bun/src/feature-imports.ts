import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import { findCssImportPaths } from './css-import-graph.ts';
import { SHIPPED_FEATURE_COPIES } from './feature-copies.ts';
import { findCopyReferences } from './feature-references.ts';
import { preflightWorkspaceWriteTargets } from './scaffold-path.ts';

export type PackagedFeatureName = 'client-nav' | 'search' | 'content-nav';

export interface PackagedFeature {
  readonly name: PackagedFeatureName;
  /** What app.ts imports now, and what it imported when the feature was copied into the app. */
  readonly script: { readonly packaged: string; readonly legacy: string };
  /** What app.css imports now, and before, for features that ship a stylesheet. */
  readonly style?: { readonly packaged: string; readonly legacy: string };
  /** The copies Webstir used to write, relative to src/frontend/app. */
  readonly copies: readonly string[];
}

const PACKAGE = '@webstir-io/webstir-frontend/features';
const APP_ENTRIES = ['app.ts', 'app.tsx', 'app.js', 'app.jsx'];

export const PACKAGED_FEATURES: Readonly<Record<PackagedFeatureName, PackagedFeature>> = {
  'client-nav': {
    name: 'client-nav',
    script: { packaged: `${PACKAGE}/client-nav`, legacy: './scripts/features/client-nav.js' },
    copies: [
      'scripts/features/client-nav.ts',
      'scripts/features/document-navigation.ts',
      'scripts/features/form-enhancement.ts',
    ],
  },
  search: {
    name: 'search',
    script: { packaged: `${PACKAGE}/search`, legacy: './scripts/features/search.js' },
    style: { packaged: `${PACKAGE}/search.css`, legacy: './styles/features/search.css' },
    copies: ['scripts/features/search.ts', 'styles/features/search.css'],
  },
  'content-nav': {
    name: 'content-nav',
    script: { packaged: `${PACKAGE}/content-nav`, legacy: './scripts/features/content-nav.js' },
    style: { packaged: `${PACKAGE}/content-nav.css`, legacy: './styles/features/content-nav.css' },
    copies: ['scripts/features/content-nav.ts', 'styles/features/content-nav.css'],
  },
};

export type FeatureAdoption = 'packaged' | 'kept-local' | 'unavailable';

/** Where an app kept its copies of a feature before it shipped in the frontend package. */
/** The app entries the build looks for, in its order; adoption rewrites the first that exists. */
export function appEntryPaths(workspaceRoot: string): readonly string[] {
  return APP_ENTRIES.map((entry) => path.join(appRoot(workspaceRoot), entry));
}

export function legacyFeaturePaths(
  workspaceRoot: string,
  name: PackagedFeatureName,
): readonly string[] {
  return PACKAGED_FEATURES[name].copies.map((copy) => path.join(appRoot(workspaceRoot), copy));
}

/**
 * Points app.ts (and app.css, for a feature with a stylesheet) at the packaged feature and removes
 * the copies Webstir used to write. Nothing is removed unless the switch is complete and safe:
 * every copy matches a version Webstir shipped, the installed frontend package exports the
 * feature, parsing confirms each rewrite, and no other source still uses a copy. Otherwise the app
 * keeps working as it is and a note says why.
 */
export async function adoptPackagedFeature(
  workspaceRoot: string,
  name: PackagedFeatureName,
  changes: string[],
  notes: string[],
  dryRun = false,
): Promise<FeatureAdoption> {
  const feature = PACKAGED_FEATURES[name];
  const present = legacyFeaturePaths(workspaceRoot, name).filter((filePath) =>
    existsSync(filePath),
  );
  const edited: string[] = [];
  for (const filePath of present) {
    // A Windows checkout of a shipped copy differs only in line endings.
    const digest = createHash('sha256')
      .update((await readFile(filePath, 'utf8')).replaceAll('\r\n', '\n'))
      .digest('hex');
    if (!SHIPPED_FEATURE_COPIES[appRelative(workspaceRoot, filePath)]?.has(digest)) {
      edited.push(relativeWorkspacePath(workspaceRoot, filePath));
    }
  }
  const copiesList = `src/frontend/app/{${feature.copies.join(',')}}`;
  if (edited.length > 0) {
    notes.push(
      `Kept the local ${name} copies because ${edited.join(', ')} differ from what Webstir shipped. ` +
        `To use the packaged version, move your changes elsewhere, delete ${copiesList}, and ${importInstructions(feature)}.`,
    );
    await wireLocalCopies(workspaceRoot, feature, present, changes, dryRun);
    return 'kept-local';
  }

  if (!installedFrontendShips(workspaceRoot, feature)) {
    notes.push(
      `The installed @webstir-io/webstir-frontend does not ship '${feature.script.packaged}'. ` +
        'Upgrade it to 0.3.0 or newer, then run this command again.' +
        (present.length > 0 ? ` The local ${name} copies were left in place.` : ''),
    );
    return 'unavailable';
  }

  const rewrites: Array<{ filePath: string; source: string; updated: string }> = [];
  // The entry the build bundles, in the order the build looks for it.
  const entryPath = appEntryPaths(workspaceRoot).find((candidate) => existsSync(candidate));
  if (!entryPath) {
    notes.push(
      `There is no src/frontend/app/app.{ts,tsx,js,jsx} to import '${feature.script.packaged}' from.` +
        (present.length > 0 ? ` The local ${name} copies were left in place.` : ''),
    );
    return 'unavailable';
  }
  const entryName = relativeWorkspacePath(workspaceRoot, entryPath);
  const entrySource = await readFile(entryPath, 'utf8');
  const entryUpdated = usePackagedScriptImport(entrySource, feature, entryPath);
  // A rewrite is only kept when parsing it shows the packaged import and no local one.
  if (!importsOnly(scanImports(entryUpdated, entryPath), feature.script)) {
    notes.push(
      `Kept the local ${name} copies because ${entryName} could not be switched automatically. ` +
        `Replace its import of '${feature.script.legacy}' with '${feature.script.packaged}', then run this command again.`,
    );
    await wireLocalCopies(workspaceRoot, feature, present, changes, dryRun);
    return 'kept-local';
  }
  rewrites.push({ filePath: entryPath, source: entrySource, updated: entryUpdated });
  const appCssPath = path.join(appRoot(workspaceRoot), 'app.css');
  if (feature.style && existsSync(appCssPath)) {
    const source = await readFile(appCssPath, 'utf8');
    const updated = usePackagedStyleImport(source, feature.style);
    if (!importsOnly(findCssImportPaths(updated), feature.style)) {
      notes.push(
        `Kept the local ${name} copies because src/frontend/app/app.css could not be switched automatically. ` +
          `Replace its @import of '${feature.style.legacy}' with '${feature.style.packaged}', then run this command again.`,
      );
      await wireLocalCopies(workspaceRoot, feature, present, changes, dryRun);
      return 'kept-local';
    }
    rewrites.push({ filePath: appCssPath, source, updated });
  }

  if (present.length > 0) {
    const rewritten = new Map(rewrites.map((rewrite) => [rewrite.filePath, rewrite.updated]));
    const stillUsing = await findCopyReferences(workspaceRoot, feature, rewritten);
    if (stillUsing.length > 0) {
      notes.push(
        `Kept the local ${name} copies because ${stillUsing.join(', ')} still use them. ` +
          `Point those imports at the packaged feature or remove them, then run this command again.`,
      );
      await wireLocalCopies(workspaceRoot, feature, present, changes, dryRun);
      return 'kept-local';
    }
  }

  await preflightWorkspaceWriteTargets(
    workspaceRoot,
    [...rewrites.map((rewrite) => rewrite.filePath), ...present],
    `switch ${name} to the packaged feature`,
  );
  for (const { filePath, source, updated } of rewrites) {
    if (updated === source) continue;
    if (!dryRun) {
      await Bun.write(filePath, updated);
    }
    changes.push(relativeWorkspacePath(workspaceRoot, filePath));
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
 * Copies that stay must still load: the app entry and app.css import each kept copy unless they
 * already import it or the packaged feature.
 */
async function wireLocalCopies(
  workspaceRoot: string,
  feature: PackagedFeature,
  present: readonly string[],
  changes: string[],
  dryRun: boolean,
): Promise<void> {
  const kept = new Set(present.map((filePath) => appRelative(workspaceRoot, filePath)));
  const copyOf = (specifier: string) => specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts');
  const writes: Array<{ filePath: string; updated: string }> = [];
  const entryPath = appEntryPaths(workspaceRoot).find((candidate) => existsSync(candidate));
  if (entryPath && kept.has(copyOf(feature.script.legacy))) {
    const source = await readFile(entryPath, 'utf8');
    const imports = scanImports(source, entryPath);
    if (!imports.includes(feature.script.legacy) && !imports.includes(feature.script.packaged)) {
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      writes.push({
        filePath: entryPath,
        updated: appendStatement(source, `import '${feature.script.legacy}';`, newline),
      });
    }
  }
  const appCssPath = path.join(appRoot(workspaceRoot), 'app.css');
  if (
    feature.style &&
    existsSync(appCssPath) &&
    kept.has(feature.style.legacy.replace(/^\.\//, ''))
  ) {
    const source = await readFile(appCssPath, 'utf8');
    const imports = findCssImportPaths(source);
    if (!imports.includes(feature.style.legacy) && !imports.includes(feature.style.packaged)) {
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      writes.push({
        filePath: appCssPath,
        updated: insertAfterLastCssImport(source, `@import "${feature.style.legacy}";`, newline),
      });
    }
  }
  await preflightWorkspaceWriteTargets(
    workspaceRoot,
    writes.map((write) => write.filePath),
    `import the local ${feature.name} copies`,
  );
  for (const { filePath, updated } of writes) {
    if (!dryRun) await Bun.write(filePath, updated);
    changes.push(relativeWorkspacePath(workspaceRoot, filePath));
  }
}

/**
 * Swaps the local import for the packaged one in place, or adds the packaged one. Only whole
 * import statements at the start of a line change, so comments and the lines around them stay as
 * they are; the file keeps its line endings. Callers confirm the result by parsing it.
 */
export function usePackagedScriptImport(
  source: string,
  feature: PackagedFeature,
  filePath = 'app.ts',
): string {
  const imports = scanImports(source, filePath);
  const legacyStatement = new RegExp(
    `^([ \\t]*)import\\s+(['"])${escapeRegExp(feature.script.legacy)}\\2[ \\t]*;?`,
    'm',
  );
  return swapStatement(
    source,
    imports,
    feature.script,
    legacyStatement,
    (indent) => `${indent}import '${feature.script.packaged}';`,
  );
}

/** The same swap for an app.css `@import`, keeping any layer or media qualifiers it had. */
export function usePackagedStyleImport(
  source: string,
  style: NonNullable<PackagedFeature['style']>,
): string {
  const legacyStatement = new RegExp(
    `^([ \\t]*)@import\\s+(?:url\\(\\s*)?(['"])${escapeRegExp(style.legacy)}\\2\\s*\\)?([^;\\r\\n]*);`,
    'm',
  );
  return swapStatement(
    source,
    findCssImportPaths(source),
    style,
    legacyStatement,
    (indent, qualifiers) =>
      `${indent}@import "${style.packaged}"${qualifiers?.trim() ? ` ${qualifiers.trim()}` : ''};`,
    (css, statement, newline) => insertAfterLastCssImport(css, statement, newline),
  );
}

function swapStatement(
  source: string,
  imports: readonly string[],
  specifiers: { readonly packaged: string; readonly legacy: string },
  legacyStatement: RegExp,
  packagedStatement: (indent: string, qualifiers?: string) => string,
  insert: (source: string, statement: string, newline: string) => string = appendStatement,
): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  if (imports.includes(specifiers.packaged)) {
    const wholeLine = new RegExp(
      `${legacyStatement.source}[ \\t]*(?:\\/\\/[^\\r\\n]*|\\/\\*[^\\r\\n]*?\\*\\/)?[ \\t]*(?:\\r?\\n|$)`,
      'gm',
    );
    return source.replace(wholeLine, '');
  }
  if (imports.includes(specifiers.legacy)) {
    return source.replace(legacyStatement, (_match, indent: string, _quote, qualifiers?: string) =>
      packagedStatement(indent, qualifiers),
    );
  }
  return insert(source, packagedStatement(''), newline);
}

function appendStatement(source: string, statement: string, newline: string): string {
  const suffix = source.endsWith('\n') || source.length === 0 ? '' : newline;
  return `${source}${suffix}${statement}${newline}`;
}

/** CSS requires @import before other rules, so a new one goes after the last existing one. */
function insertAfterLastCssImport(css: string, statement: string, newline: string): string {
  const lines = css.split(/\r?\n/);
  let last = -1;
  lines.forEach((line, index) => {
    if (/^\s*@import\b/.test(line)) last = index;
  });
  if (last === -1) {
    const layerOrder = lines.findIndex((line) => /^\s*@layer\s+[^{]*;/.test(line));
    last = layerOrder;
  }
  lines.splice(last + 1, 0, statement);
  return lines.join(newline);
}

function importsOnly(
  imports: readonly string[],
  specifiers: { readonly packaged: string; readonly legacy: string },
): boolean {
  return imports.includes(specifiers.packaged) && !imports.includes(specifiers.legacy);
}

/**
 * The modules a file loads when it runs, parsed by Bun so comments and strings never count. Only
 * static imports: a dynamic import() does not start a feature with the page.
 */
export function scanImports(source: string, filePath: string): string[] {
  const extension = path.extname(filePath).slice(1);
  const loader =
    extension === 'tsx' || extension === 'jsx' || extension === 'js' ? extension : 'ts';
  try {
    return new Bun.Transpiler({ loader })
      .scanImports(source)
      .filter((entry) => entry.kind === 'import-statement')
      .map((entry) => entry.path);
  } catch {
    return [];
  }
}

/** Whether the frontend package this app resolves exports the feature (and its stylesheet). */
function installedFrontendShips(workspaceRoot: string, feature: PackagedFeature): boolean {
  try {
    const require = createRequire(path.resolve(workspaceRoot, 'package.json'));
    const manifestPath = require.resolve('@webstir-io/webstir-frontend/package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    const exported = (specifier: string) =>
      Boolean(manifest.exports?.[`./${specifier.slice('@webstir-io/webstir-frontend/'.length)}`]);
    return (
      exported(feature.script.packaged) && (!feature.style || exported(feature.style.packaged))
    );
  } catch {
    return false;
  }
}

function importInstructions(feature: PackagedFeature): string {
  const script = `import '${feature.script.packaged}' in src/frontend/app/app.ts`;
  return feature.style
    ? `${script} and @import "${feature.style.packaged}" in src/frontend/app/app.css`
    : script;
}

function appRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, 'src', 'frontend', 'app');
}

function appRelative(workspaceRoot: string, filePath: string): string {
  return path.relative(appRoot(workspaceRoot), filePath).split(path.sep).join('/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function relativeWorkspacePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).split(path.sep).join('/');
}
