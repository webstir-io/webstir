import { load } from 'cheerio';
import type { Element } from 'domhandler';

import type { RenderIssue } from '../render/issues.js';

export const ISLAND_LOAD_STRATEGIES = ['load', 'idle', 'visible', 'media'] as const;
export const ISLANDS_LOADER_ATTRIBUTE = 'data-webstir-islands';
export const DEV_ISLANDS_LOADER = '/app/islands/runtime/loader.js';

/**
 * Checks each `data-island` element in a template: it names an island the app has, and its
 * `data-load` is one Webstir knows, with `data-media` when it is `media`.
 */
export function checkIslandElements(
  html: string,
  file: string,
  islands: ReadonlySet<string>,
): RenderIssue[] {
  if (!html.includes('data-island')) return [];
  const document = load(html, { sourceCodeLocationInfo: true });
  const issues: RenderIssue[] = [];
  for (const element of document('[data-island]').toArray() as Element[]) {
    const loc = { file, line: element.sourceCodeLocation?.startLine ?? 1 };
    const name = element.attribs['data-island'] ?? '';
    if (!islands.has(name)) {
      issues.push({
        loc,
        message: `data-island="${name}" names no island; add src/frontend/islands/${name || '<name>'}.tsx (or .svelte, .vue, .ts)`,
      });
    }
    const strategy = element.attribs['data-load'];
    if (
      strategy !== undefined &&
      !(ISLAND_LOAD_STRATEGIES as readonly string[]).includes(strategy)
    ) {
      issues.push({
        loc,
        message: `data-load="${strategy}" is not a load strategy; use ${ISLAND_LOAD_STRATEGIES.join(', ')}`,
      });
    }
    if (strategy === 'media' && !element.attribs['data-media']) {
      issues.push({
        loc,
        message: 'data-load="media" needs a data-media query, such as "(min-width: 800px)"',
      });
    }
  }
  return issues;
}

/** A page with islands loads the islands loader; one without ships no island code. */
export function injectIslandsLoader(html: string, loader: string): string {
  if (!/\sdata-island\s*=/.test(html) || html.includes(ISLANDS_LOADER_ATTRIBUTE)) return html;
  const tag = `<script type="module" src="${loader}" ${ISLANDS_LOADER_ATTRIBUTE}></script>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tag}</head>`) : `${tag}${html}`;
}

/** Points a page's islands loader at the published, fingerprinted one. */
export function publishIslandsLoader(html: string, loader: string | undefined): string {
  if (!html.includes(ISLANDS_LOADER_ATTRIBUTE)) return html;
  if (!loader) {
    throw new Error(
      '[webstir-frontend] a page uses islands, but the published site has no islands loader.',
    );
  }
  return html.split(`src="${DEV_ISLANDS_LOADER}"`).join(`src="${loader}"`);
}
