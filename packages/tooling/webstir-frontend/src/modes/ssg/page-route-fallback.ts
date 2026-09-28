import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { readWorkspacePageRoutes, type PageRoute } from '@webstir-io/module-contract/page-routes';

import { FILES, FOLDERS } from '../../core/constants.js';
import { copy, ensureDir, pathExists } from '../../utils/fs.js';

/**
 * A static host serves files, so a page a view routes to at other addresses needs help there.
 * A pattern without parameters gets the page's HTML as a file at that address
 * (`writeFixedPageRoutes`, before the site's aliases and sitemap are made). A pattern with
 * parameters (`/items/:id`) can't have a file per address, so the site gets a `_redirects` rewrite
 * (Netlify, Cloudflare Pages) and a `404.html` that loads the routed page (GitHub Pages, S3 and
 * any host that serves `404.html` for a missing address), in `writePageRouteFallbacks`. The page's
 * `load` reads the parameter from the address.
 */
interface PageRouteOptions {
  readonly workspaceRoot: string;
  readonly distRoot: string;
  readonly pageDirectory: (page: string) => string;
  /** Pages a view rendered at publish; their addresses are files already. */
  readonly renderedPages: ReadonlySet<string>;
  /** Called for each file written, so precompressed copies stay in step. */
  readonly written: (file: string) => Promise<void>;
}

export async function writeFixedPageRoutes(options: PageRouteOptions): Promise<void> {
  for (const route of await readPublishedRoutes(options)) {
    if (isDynamic(route)) continue;
    const target = path.join(options.distRoot, ...route.pattern.split('/').filter(Boolean));
    const targetHtml = path.join(target, FILES.indexHtml);
    if (await pathExists(targetHtml)) continue;
    await ensureDir(target);
    await copy(pageHtmlPath(options, route.page), targetHtml);
    await options.written(targetHtml);
  }
}

export async function writePageRouteFallbacks(options: PageRouteOptions): Promise<void> {
  const notFound = path.join(options.distRoot, '404.html');
  // The app's 404 page publishes as 404/index.html; hosts look for /404.html.
  const notFoundPage = path.join(options.distRoot, '404', FILES.indexHtml);
  const hasNotFoundPage = await pathExists(notFoundPage);
  const dynamic = (await readPublishedRoutes(options)).filter(isDynamic);
  const first = dynamic[0];
  if (!first) {
    if (hasNotFoundPage && !(await pathExists(notFound))) {
      await copy(notFoundPage, notFound);
      await options.written(notFound);
    }
    return;
  }

  const rules = dynamic.map((route) => [route.pattern, pageAddress(route.page)] as const);
  // The site's base path, as its pages declare it.
  const firstPage = await readFile(pageHtmlPath(options, first.page), 'utf8');
  const base = /data-webstir-base="([^"]*)"/.exec(firstPage)?.[1] ?? '';
  await appendRedirects(options.distRoot, rules);
  await options.written(path.join(options.distRoot, '_redirects'));
  await writeFile(
    notFound,
    notFoundRouter(rules, base, hasNotFoundPage ? pageAddress('404') : null),
    'utf8',
  );
  await options.written(notFound);
}

async function readPublishedRoutes(options: PageRouteOptions): Promise<readonly PageRoute[]> {
  const routes = (await readWorkspacePageRoutes(options.workspaceRoot)).filter(
    (route) => !options.renderedPages.has(route.page),
  );
  for (const route of routes) {
    const pageHtml = pageHtmlPath(options, route.page);
    if (!(await pathExists(pageHtml))) {
      throw new Error(
        `[webstir-frontend] view path ${route.pattern} routes to page "${route.page}", but the published site has no ${path.relative(options.distRoot, pageHtml)}.`,
      );
    }
  }
  return routes;
}

function isDynamic(route: PageRoute): boolean {
  return route.pattern.split('/').some((segment) => segment.startsWith(':'));
}

function pageHtmlPath(options: PageRouteOptions, page: string): string {
  return path.join(options.pageDirectory(page), FILES.indexHtml);
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

/**
 * A document with no scripts of its own but this router, so the page it loads in its place runs
 * every script fresh: the routed page for a routed address, else the app's 404 page.
 */
function notFoundRouter(
  rules: readonly (readonly [string, string])[],
  base: string,
  notFoundPage: string | null,
): string {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const script = `(function () {
  var routes = ${json(rules)};
  var base = ${json(base.replace(/\/+$/, ''))};
  var notFoundPage = ${json(notFoundPage)};
  var pathname = location.pathname;
  if (base && pathname.indexOf(base + '/') === 0) pathname = pathname.slice(base.length);
  var segments = pathname.split('/').filter(Boolean);
  var target = notFoundPage;
  for (var i = 0; i < routes.length; i += 1) {
    var expected = routes[i][0].split('/').filter(Boolean);
    if (expected.length !== segments.length) continue;
    var matches = true;
    for (var j = 0; j < expected.length; j += 1) {
      if (expected[j].charAt(0) !== ':' && expected[j] !== segments[j]) { matches = false; break; }
    }
    if (matches) { target = routes[i][1]; break; }
  }
  function show(html) {
    document.open();
    document.write(html);
    document.close();
  }
  function notFound() {
    show('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not found<\\/title><\\/head><body><main><h1>Not found<\\/h1><\\/main><\\/body><\\/html>');
  }
  if (!target) { notFound(); return; }
  fetch(base + target)
    .then(function (response) {
      if (!response.ok) throw new Error('page ' + response.status);
      return response.text();
    })
    .then(show, notFound);
})();`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>Loading</title><script>${script}</script></head><body></body></html>\n`;
}
