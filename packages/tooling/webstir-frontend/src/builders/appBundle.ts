import { createRequire } from 'node:module';
import path from 'node:path';

import { readWorkspaceLayers } from '@webstir-io/module-contract/workspace';

import { EXTENSIONS, FILES } from '../core/constants.js';
import { pathExists, writeFile, ensureDir } from '../utils/fs.js';
import type { BuilderContext } from './types.js';

const FEATURES = '@webstir-io/webstir-frontend/features/';
const APP_ENTRY_FILES = ['app.ts', 'app.tsx', 'app.js', 'app.jsx'];
const ownRequire = createRequire(import.meta.url);

/**
 * Webstir's modules resolve from the app's install, where the app's own imports of them resolve
 * too, so the bundler includes each once; an app without it installed gets the building package's.
 */
function resolveWebstirModule(workspaceRoot: string, specifier: string): string {
  try {
    return createRequire(path.join(workspaceRoot, FILES.packageJson)).resolve(specifier);
  } catch {
    return ownRequire.resolve(specifier);
  }
}

/**
 * What the app bundle every page loads is made of: Webstir's error reporter (an app with a server
 * reports to it, unless `clientErrors` says otherwise), each enabled feature, and the app's own
 * `app.ts` when it has one. Empty means the app has no bundle.
 */
export async function appBundleImports(context: BuilderContext): Promise<string[]> {
  const { config, enable } = context;
  const imports: string[] = [];
  if (enable?.clientErrors ?? readWorkspaceLayers(config.paths.workspace).server) {
    imports.push(resolveWebstirModule(config.paths.workspace, `${FEATURES}client-errors`));
  }
  for (const [on, name] of [
    [enable?.clientNav, 'client-nav'],
    [enable?.search, 'search'],
    [enable?.contentNav, 'content-nav'],
  ] as const) {
    // An app that still has the copy an older version wrote imports that copy itself.
    if (on === true && !(await hasFeatureCopy(config, name))) {
      imports.push(resolveWebstirModule(config.paths.workspace, `${FEATURES}${name}`));
    }
  }
  const own = await resolveAppEntry(config.paths.src.app);
  if (own) imports.push(own);
  return imports;
}

/** Writes the bundle's entry for the bundler, or returns null when the app has no bundle. */
export async function writeAppBundleEntry(context: BuilderContext): Promise<string | null> {
  const imports = await appBundleImports(context);
  if (imports.length === 0) return null;
  // Named app.js so the bundle is app.js; inside the workspace so the package resolves from it.
  const entry = path.join(context.config.paths.build.frontend, '.app-bundle', 'app.js');
  await ensureDir(path.dirname(entry));
  await writeFile(
    entry,
    imports.map((specifier) => `import ${JSON.stringify(specifier)};\n`).join(''),
  );
  return entry;
}

export async function resolveAppEntry(appRoot: string): Promise<string | null> {
  for (const file of APP_ENTRY_FILES) {
    const candidate = path.join(appRoot, file);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function hasFeatureCopy(config: BuilderContext['config'], name: string): Promise<boolean> {
  const root = path.join(config.paths.src.app, 'scripts', 'features');
  return (
    (await pathExists(path.join(root, `${name}${EXTENSIONS.ts}`))) ||
    (await pathExists(path.join(root, `${name}${EXTENSIONS.js}`)))
  );
}
