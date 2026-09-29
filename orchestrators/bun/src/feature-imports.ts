import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  findCssImportInsertionPoint,
  findCssImportPaths,
  resolveLocalCssDependencyGraph,
} from './css-import-graph.ts';
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
    await wireLocalCopies(workspaceRoot, feature, present, changes, notes, dryRun);
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
  // The build adds an enabled feature to the app bundle itself, so the app entry keeps no import of
  // it, packaged or local. An app without an entry has nothing to change.
  const entryPath = appEntryPaths(workspaceRoot).find((candidate) => existsSync(candidate));
  if (entryPath) {
    const entryName = relativeWorkspacePath(workspaceRoot, entryPath);
    const entrySource = await readFile(entryPath, 'utf8');
    const entryUpdated = withoutStatement(
      usePackagedScriptImport(entrySource, feature, entryPath),
      packagedScriptStatement(feature.script.packaged),
    );
    // A rewrite is only kept when parsing it shows neither import left.
    if (importsEither(scanImports(entryUpdated, entryPath), feature.script)) {
      notes.push(
        `Kept the local ${name} copies because ${entryName} could not be switched automatically. ` +
          `Remove its import of '${feature.script.legacy}' (the build adds the feature), then run this command again.`,
      );
      await wireLocalCopies(workspaceRoot, feature, present, changes, notes, dryRun);
      return 'kept-local';
    }
    rewrites.push({ filePath: entryPath, source: entrySource, updated: entryUpdated });
  }
  const appCssPath = path.join(appRoot(workspaceRoot), 'app.css');
  if (feature.style && existsSync(appCssPath)) {
    const source = await readFile(appCssPath, 'utf8');
    const updated = withoutStatement(
      usePackagedStyleImport(source, feature.style),
      packagedStyleStatement(feature.style.packaged),
    );
    if (importsEither(findCssImportPaths(updated), feature.style)) {
      notes.push(
        `Kept the local ${name} copies because src/frontend/app/app.css could not be switched automatically. ` +
          `Remove its @import of '${feature.style.legacy}' (the build adds the feature's styles), then run this command again.`,
      );
      await wireLocalCopies(workspaceRoot, feature, present, changes, notes, dryRun);
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
      await wireLocalCopies(workspaceRoot, feature, present, changes, notes, dryRun);
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
      // An entry left with nothing of the app's own goes; the build needs none.
      if (filePath === entryPath && isEmptyEntry(updated)) await rm(filePath);
      else await Bun.write(filePath, updated);
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
  notes: string[],
  dryRun: boolean,
): Promise<void> {
  const kept = new Set(present.map((filePath) => appRelative(workspaceRoot, filePath)));
  const copyOf = (specifier: string) => specifier.replace(/^\.\//, '').replace(/\.js$/, '.ts');
  const writes: Array<{ filePath: string; updated: string }> = [];
  const add = (filePath: string, updated: string, imported: boolean, statement: string) => {
    // Kept only when parsing the result shows the import.
    if (imported) {
      writes.push({ filePath, updated });
    } else {
      notes.push(
        `Add ${statement} to ${relativeWorkspacePath(workspaceRoot, filePath)} so the local ${feature.name} copies load.`,
      );
    }
  };
  const entryPath = appEntryPaths(workspaceRoot).find((candidate) => existsSync(candidate));
  const scriptCopy = copyOf(feature.script.legacy);
  if (entryPath && kept.has(scriptCopy)) {
    const source = await readFile(entryPath, 'utf8');
    // The entry's runtime imports; importing a module twice still runs it once.
    const imports = scanImports(source, entryPath);
    if (!imports.includes(feature.script.packaged) && !imports.includes(feature.script.legacy)) {
      const statement = `import '${feature.script.legacy}';`;
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      const updated = appendStatement(source, statement, newline);
      add(
        entryPath,
        updated,
        scanImports(updated, entryPath).includes(feature.script.legacy),
        statement,
      );
    }
  }
  const appCssPath = path.join(appRoot(workspaceRoot), 'app.css');
  const styleCopy = feature.style?.legacy.replace(/^\.\//, '');
  if (feature.style && styleCopy && existsSync(appCssPath) && kept.has(styleCopy)) {
    const source = await readFile(appCssPath, 'utf8');
    // What app.css loads, through any stylesheet it imports and whatever its conditions: a
    // second, unconditional import would change where the copy applies.
    const loaded = await resolveLocalCssDependencyGraph(appCssPath);
    if (
      !findCssImportPaths(source).includes(feature.style.packaged) &&
      !loaded.has(path.resolve(appRoot(workspaceRoot), styleCopy))
    ) {
      const statement = `@import "${feature.style.legacy}";`;
      const newline = source.includes('\r\n') ? '\r\n' : '\n';
      const updated = insertAfterLastCssImport(source, statement, newline);
      add(
        appCssPath,
        updated,
        findCssImportPaths(updated).includes(feature.style.legacy),
        statement,
      );
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

/** CSS requires @import before other rules, so a new one goes after the stylesheet's prelude. */
function insertAfterLastCssImport(css: string, statement: string, newline: string): string {
  const point = findCssImportInsertionPoint(css);
  const start = css.charCodeAt(0) === 0xfeff ? 1 : 0;
  return point === start
    ? `${css.slice(0, point)}${statement}${newline}${css.slice(point)}`
    : `${css.slice(0, point)}${newline}${statement}${css.slice(point)}`;
}

export function isEmptyEntry(source: string): boolean {
  return source.replace('// Global app initialization', '').trim() === '';
}

function importsEither(
  imports: readonly string[],
  specifiers: { readonly packaged: string; readonly legacy: string },
): boolean {
  return imports.includes(specifiers.packaged) || imports.includes(specifiers.legacy);
}

// A comment after the statement, on its line, describes it and goes with it.
const TRAILING_COMMENT = String.raw`[^\S\r\n]*(?:\/\/[^\r\n]*|\/\*[^\r\n]*?\*\/[^\S\r\n]*)?`;

function packagedScriptStatement(specifier: string): RegExp {
  return new RegExp(
    `^[ \\t]*import\\s+(['"])${escapeRegExp(specifier)}\\1[ \\t]*;?${TRAILING_COMMENT}(?:\\r?\\n|$)`,
    'gm',
  );
}

function packagedStyleStatement(specifier: string): RegExp {
  return new RegExp(
    `^[ \\t]*@import\\s+(?:url\\(\\s*)?(['"])${escapeRegExp(specifier)}\\1\\s*\\)?[^;\\r\\n]*;${TRAILING_COMMENT}(?:\\r?\\n|$)`,
    'gm',
  );
}

/** Drops each whole line the statement is on. */
function withoutStatement(source: string, statement: RegExp): string {
  return source.replace(statement, '');
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
  const script = `import of '${feature.script.legacy}' from src/frontend/app/app.ts`;
  const imports = feature.style
    ? `${script} and the @import of '${feature.style.legacy}' from src/frontend/app/app.css`
    : script;
  return `remove the ${imports}; the build adds the packaged feature while its flag is on`;
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
