import type { CheerioAPI } from 'cheerio';
import { resolvePageHtmlUrl } from '../utils/pagePaths.js';

export interface ResourceHintResult {
  readonly added: number;
  readonly candidates: string[];
  readonly missingHead: boolean;
}

/**
 * Adds `<link rel="prefetch">` hints for links that point at other frontend pages.
 *
 * Only `knownPages` (the page directories that were actually built) are eligible. Links whose
 * first path segment is not a page, such as backend routes, produce no hint; otherwise a
 * published page would prefetch a document that does not exist.
 */
export function injectResourceHints(
  document: CheerioAPI,
  currentPage: string,
  pagesUrlPrefix: string,
  useRootIndex: boolean,
  knownPages: ReadonlySet<string>,
): ResourceHintResult {
  const head = document('head').first();
  const targets = collectInternalPages(document, currentPage, pagesUrlPrefix, knownPages);
  const pages = [...targets.keys()];

  if (head.length === 0) {
    return {
      added: 0,
      candidates: pages,
      missingHead: pages.length > 0,
    };
  }

  if (pages.length === 0) {
    return { added: 0, candidates: [], missingHead: false };
  }

  for (const [page, target] of targets) {
    // Server pages are request-time views; their templates cannot be fetched directly.
    const href = useRootIndex ? resolvePageHtmlUrl(pagesUrlPrefix, page, true) : target;
    head.append(document('<link rel="prefetch" as="document">').attr('href', href));
  }

  return { added: pages.length, candidates: pages, missingHead: false };
}

function collectInternalPages(
  document: CheerioAPI,
  currentPage: string,
  pagesUrlPrefix: string,
  knownPages: ReadonlySet<string>,
): Map<string, string> {
  const pages = new Map<string, string>();
  document('a[href]').each((_index, element) => {
    const href = document(element).attr('href')?.trim();
    if (!href) return;
    const pageName = normalizePageName(href, pagesUrlPrefix);
    if (!pageName || pageName === currentPage || !knownPages.has(pageName)) {
      return;
    }
    if (!pages.has(pageName)) {
      pages.set(pageName, href.replace(/#.*/, ''));
    }
  });
  return pages;
}

function normalizePageName(href: string, pagesUrlPrefix: string): string | null {
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(href) ||
    href.startsWith('//') ||
    href.includes('\\') ||
    Array.from(href).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    href.startsWith('#')
  ) {
    return null;
  }

  let path = href.split('#')[0]?.split('?')[0] ?? '';
  if (path.length === 0) {
    return null;
  }

  if (path.startsWith('/')) {
    path = path.slice(1);
  }

  const prefix = trimSlashes(pagesUrlPrefix);
  if (prefix && path.startsWith(`${prefix}/`)) {
    path = path.slice(prefix.length + 1);
  }

  if (path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  const segments = path.split('/');
  const candidate = segments[0];
  if (!candidate) {
    return null;
  }

  return candidate;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
