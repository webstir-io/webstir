import path from 'node:path';

import postcss from 'postcss';

import { pathExists } from '../utils/fs.js';
import { parseCssImport } from './cssImports.js';
import type { BuilderContext } from './types.js';

const FEATURES = '@webstir-io/webstir-frontend/features/';

/**
 * The stylesheets of enabled features the build adds to the app's styles. An app that still has
 * the copy an older version wrote imports that copy itself.
 */
export async function featureStyleImports(context: BuilderContext): Promise<string[]> {
  const { config, enable } = context;
  const imports: string[] = [];
  for (const [on, name] of [
    [enable?.search, 'search'],
    [enable?.contentNav, 'content-nav'],
  ] as const) {
    const copy = path.join(config.paths.src.app, 'styles', 'features', `${name}.css`);
    if (on === true && !(await pathExists(copy))) imports.push(`${FEATURES}${name}.css`);
  }
  return imports;
}

/** Whether the app has styles for every page: its own app.css, or an enabled feature's. */
export async function hasAppStyles(context: BuilderContext): Promise<boolean> {
  return (
    (await pathExists(path.join(context.config.paths.src.app, 'app.css'))) ||
    (await featureStyleImports(context)).length > 0
  );
}

/**
 * app.css with the enabled features' stylesheets imported after its own imports, except those it
 * already imports.
 */
export function withFeatureStyles(css: string, imports: readonly string[]): string {
  if (imports.length === 0) return css;
  const root = postcss.parse(css);
  const present = new Set<string>();
  root.walkAtRules('import', (rule) => {
    const parsed = parseCssImport(rule.params);
    if (parsed) present.add(parsed.path);
  });
  const added = imports
    .filter((specifier) => !present.has(specifier))
    .map((specifier) => postcss.atRule({ name: 'import', params: JSON.stringify(specifier) }));
  if (added.length === 0) return css;

  // CSS only honors @import ahead of every other rule but @charset and @layer statements.
  let last: postcss.ChildNode | undefined;
  for (const node of root.nodes) {
    if (node.type === 'comment') continue;
    const leading =
      node.type === 'atrule' &&
      (node.name === 'import' || node.name === 'charset' || (node.name === 'layer' && !node.nodes));
    if (!leading) break;
    last = node;
  }
  if (last) last.after(added);
  else root.prepend(added);
  return root.toString();
}
