import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { readWorkspacePageRoutes, type PageRoute } from '@webstir-io/module-contract/page-routes';

import { FILES, FOLDERS } from '../../core/constants.js';
import { copy, ensureDir, pathExists } from '../../utils/fs.js';

/**
 * A static host serves files, so a page a view routes to at other addresses needs help there:
 * - a pattern without parameters gets the page's HTML as a file at that address;
 * - a pattern with parameters (`/items/:id`) can't have a file per address, so the site gets a
 *   `_redirects` rewrite (Netlify, Cloudflare Pages) and a `404.html` that loads the page in place
 *   (GitHub Pages, S3 and any host that serves `404.html` for a missing address). The page's
 *   `load` reads the parameter from the address.
 */
export async function writePageRouteFallbacks(options: {
  readonly workspaceRoot: string;
  readonly distRoot: string;
  readonly pageDirectory: (page: string) => string;
}): Promise<void> {
  const routes = await readWorkspacePageRoutes(options.workspaceRoot);
  const dynamic: PageRoute[] = [];
  for (const route of routes) {
    const pageHtml = path.join(options.pageDirectory(route.page), FILES.indexHtml);
    if (!(await pathExists(pageHtml))) {
      throw new Error(
        `[webstir-frontend] view path ${route.pattern} routes to page "${route.page}", but the published site has no ${path.relative(options.distRoot, pageHtml)}.`,
      );
    }
    if (route.pattern.split('/').some((segment) => segment.startsWith(':'))) {
      dynamic.push(route);
      continue;
    }
    const target = path.join(options.distRoot, ...route.pattern.split('/').filter(Boolean));
    const targetHtml = path.join(target, FILES.indexHtml);
    if (!(await pathExists(targetHtml))) {
      await ensureDir(target);
      await copy(pageHtml, targetHtml);
    }
  }
  if (dynamic.length === 0) {
    return;
  }

  const rules = dynamic.map((route) => [route.pattern, pageAddress(route.page)] as const);
  await appendRedirects(options.distRoot, rules);
  await writeNotFoundRouter(options.distRoot, rules);
}

function pageAddress(page: string): string {
  return page === FOLDERS.home ? '/' : `/${page}/`;
}

async function appendRedirects(
  distRoot: string,
  rules: readonly (readonly [string, string])[],
): Promise<void> {
  const file = path.join(distRoot, '_redirects');
  // An app's own rules come first, so they win where both match.
  const existing = (await pathExists(file)) ? await readFile(file, 'utf8') : '';
  const lines = rules.map(([pattern, page]) => `${pattern} ${page} 200`);
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
  await writeFile(file, `${prefix}${lines.join('\n')}\n`, 'utf8');
}

async function writeNotFoundRouter(
  distRoot: string,
  rules: readonly (readonly [string, string])[],
): Promise<void> {
  const file = path.join(distRoot, '404.html');
  const script = `<script>${notFoundRouter(rules)}</script>`;
  if (await pathExists(file)) {
    const html = await readFile(file, 'utf8');
    // First in <head>, so a routed address shows its page, never the not-found page in between.
    const next = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (tag) => `${tag}${script}`)
      : `${script}${html}`;
    await writeFile(file, next, 'utf8');
    return;
  }
  await writeFile(
    file,
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">${script}<title>Not found</title></head><body><main><h1>Not found</h1></main></body></html>\n`,
    'utf8',
  );
}

/** Loads the page a routed address belongs to in place of the not-found page, keeping the address. */
function notFoundRouter(rules: readonly (readonly [string, string])[]): string {
  return `(function () {
  var routes = ${JSON.stringify(rules).replace(/</g, '\\u003c')};
  var root = document.documentElement;
  var base = (root.getAttribute('data-webstir-base') || '').replace(/\\/+$/, '');
  var pathname = location.pathname;
  if (base && pathname.indexOf(base + '/') === 0) pathname = pathname.slice(base.length);
  var segments = pathname.split('/').filter(Boolean);
  for (var i = 0; i < routes.length; i += 1) {
    var expected = routes[i][0].split('/').filter(Boolean);
    if (expected.length !== segments.length) continue;
    var matches = true;
    for (var j = 0; j < expected.length; j += 1) {
      if (expected[j].charAt(0) !== ':' && expected[j] !== segments[j]) { matches = false; break; }
    }
    if (!matches) continue;
    root.style.visibility = 'hidden';
    fetch(base + routes[i][1])
      .then(function (response) {
        if (!response.ok) throw new Error('page ' + response.status);
        return response.text();
      })
      .then(function (html) {
        document.open();
        document.write(html);
        document.close();
      })
      .catch(function () { root.style.visibility = ''; });
    return;
  }
})();`;
}
