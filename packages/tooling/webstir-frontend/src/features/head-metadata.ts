/** A `<meta>` or `<link>` in `<head>`: its tag name and attributes. */
export interface HeadElementDescriptor {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface HeadMetadataSync {
  /** Indices into `current` of the metadata the outgoing page brought. */
  readonly remove: readonly number[];
  /** Indices into `next` of the metadata the incoming page brings, in its order. */
  readonly add: readonly number[];
  /** The referrer policy loading the incoming page would give its document. */
  readonly referrerPolicy: string;
}

const PAGE_LINK_RELS = new Set(['canonical', 'alternate', 'prev', 'next']);

const REFERRER_POLICIES = new Set([
  'no-referrer',
  'no-referrer-when-downgrade',
  'same-origin',
  'origin',
  'strict-origin',
  'origin-when-cross-origin',
  'strict-origin-when-cross-origin',
  'unsafe-url',
]);

// Legacy meta keywords, as browsers map them: `default` is the old default, not today's.
const LEGACY_REFERRER_POLICIES: Readonly<Record<string, string>> = {
  never: 'no-referrer',
  default: 'no-referrer-when-downgrade',
  always: 'unsafe-url',
  'origin-when-crossorigin': 'origin-when-cross-origin',
};

const DEFAULT_REFERRER_POLICY = 'strict-origin-when-cross-origin';

const IGNORED_BASE_PROTOCOLS = new Set(['data:', 'javascript:']);

const PAGE_LINK_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Metadata that belongs to the page rather than the document: every `<meta name>` except
 * `viewport`, every `<meta property>` (Open Graph), and `<link>`s whose rel is only
 * canonical, alternate, prev or next. `charset`, `http-equiv`, `viewport`, stylesheets, icons
 * and everything else stay as the first load left them.
 */
export function isPageMetadata(element: HeadElementDescriptor): boolean {
  const tag = element.tag.toLowerCase();
  const attributes = element.attributes;
  if (tag === 'meta') {
    if ('charset' in attributes || 'http-equiv' in attributes) return false;
    const name = attributes.name?.trim().toLowerCase();
    if (name) return name !== 'viewport';
    return Boolean(attributes.property?.trim());
  }
  if (tag === 'link') {
    const rels = (attributes.rel ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return rels.length > 0 && rels.every((rel) => PAGE_LINK_RELS.has(rel));
  }
  return false;
}

/**
 * How client-nav brings the incoming page's metadata along: the outgoing page's metadata goes, the
 * incoming page's comes in its order, and the referrer policy becomes what a full load of the
 * incoming page would give (its last valid `<meta name=referrer>`, else its `Referrer-Policy`
 * header, else the browser default). Removing a referrer meta does not undo its policy, so the
 * policy is always stated.
 */
export function resolveHeadMetadataSync(options: {
  readonly current: readonly HeadElementDescriptor[];
  readonly next: readonly HeadElementDescriptor[];
  readonly referrerPolicyHeader: string | null;
}): HeadMetadataSync {
  const remove = pageMetadataIndices(options.current);
  const add = pageMetadataIndices(options.next);
  let referrerPolicy = parseReferrerPolicyHeader(options.referrerPolicyHeader);
  for (const { attributes } of options.next.filter(isPageMetadata)) {
    if (attributes.name?.toLowerCase() !== 'referrer') continue;
    referrerPolicy = parseReferrerPolicyMeta(attributes.content) ?? referrerPolicy;
  }
  return { remove, add, referrerPolicy: referrerPolicy ?? DEFAULT_REFERRER_POLICY };
}

/**
 * Where a metadata href from the incoming page points: resolved against that page's own base, its
 * first `<base href>` read against its address, as a full load of it would. Like a browser, a base
 * that does not parse or is a `data:` or `javascript:` URL is ignored. Only an http(s) result is
 * kept: page links name pages, so any other scheme is refused and the link left out.
 */
export function resolveMetadataHref(options: {
  readonly href: string;
  readonly url: string;
  readonly baseHref: string | null;
}): string | null {
  let base = options.url;
  if (options.baseHref !== null) {
    try {
      const resolved = new URL(options.baseHref, options.url);
      if (!IGNORED_BASE_PROTOCOLS.has(resolved.protocol)) base = resolved.href;
    } catch {}
  }
  try {
    const resolved = new URL(options.href, base);
    return PAGE_LINK_PROTOCOLS.has(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

// The policy the last client navigation set, before any referrer meta in the page's content; null
// until then, because the first load's Referrer-Policy header cannot be read.
let committedReferrerPolicy: string | null = null;

/**
 * Chromium applies a referrer meta in a document parsed off screen (DOMParser) to the page on
 * screen. Until the parsed page commits, requests still come from the page on screen, so put its
 * policy back: its last valid referrer meta, else the policy the last client navigation set, else
 * no-referrer, the one choice that cannot loosen an unknown first-load header.
 */
export function restoreReferrerPolicy(parsed: Document): void {
  if (referrerMetaContents(parsed).length === 0) return;
  let policy = committedReferrerPolicy;
  for (const content of referrerMetaContents(document)) {
    policy = parseReferrerPolicyMeta(content) ?? policy;
  }
  applyReferrerPolicy(policy ?? 'no-referrer');
}

/**
 * Replace the current page's title and metadata with `doc`'s, fetched from `url`. Run it once the
 * address has changed and before any of the page's stylesheets or content goes in, so each of its
 * requests carries its own address under its own policy, and a referrer meta inside that content
 * applies after the head's, as in a full load.
 */
export function syncHeadMetadata(
  doc: Document,
  url: string,
  referrerPolicyHeader: string | null,
): void {
  document.title = doc.title;
  const head = document.head;
  const newHead = doc.head;
  if (!head || !newHead) return;

  const baseHref = doc.querySelector('base[href]')?.getAttribute('href') ?? null;
  const current = headMetadataCandidates(head);
  const next = headMetadataCandidates(newHead);
  const sync = resolveHeadMetadataSync({
    current: current.map(describe),
    next: next.map(describe),
    referrerPolicyHeader,
  });

  const removed = new Set(sync.remove);
  const added = new Set(sync.add);
  for (const element of current.filter((_, index) => removed.has(index))) element.remove();
  for (const element of next.filter((_, index) => added.has(index))) {
    const copy = copyMetadata(element, url, baseHref);
    if (copy) head.appendChild(copy);
  }

  committedReferrerPolicy = sync.referrerPolicy;
  applyReferrerPolicy(sync.referrerPolicy);
}

// A referrer meta sets the policy when it is inserted and keeps it after it is removed.
function applyReferrerPolicy(value: string): void {
  const policy = document.createElement('meta');
  policy.name = 'referrer';
  policy.content = value;
  document.head.appendChild(policy);
  policy.remove();
}

function referrerMetaContents(doc: Document): (string | undefined)[] {
  return Array.from(doc.querySelectorAll('meta[name]'))
    .filter((meta) => meta.getAttribute('name')?.toLowerCase() === 'referrer')
    .map((meta) => meta.getAttribute('content') ?? undefined);
}

function pageMetadataIndices(elements: readonly HeadElementDescriptor[]): number[] {
  const indices: number[] = [];
  elements.forEach((element, index) => {
    if (isPageMetadata(element)) indices.push(index);
  });
  return indices;
}

function parseReferrerPolicyHeader(value: string | null): string | null {
  let policy: string | null = null;
  for (const token of (value ?? '').split(',')) {
    const normalized = token.trim().toLowerCase();
    if (REFERRER_POLICIES.has(normalized)) policy = normalized;
  }
  return policy;
}

function parseReferrerPolicyMeta(value: string | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase();
  const policy = LEGACY_REFERRER_POLICIES[normalized] ?? normalized;
  return REFERRER_POLICIES.has(policy) ? policy : null;
}

function headMetadataCandidates(head: HTMLHeadElement): Element[] {
  return Array.from(head.children).filter(
    (element) => element.localName === 'meta' || element.localName === 'link',
  );
}

function describe(element: Element): HeadElementDescriptor {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = attribute.value;
  }
  return { tag: element.localName, attributes };
}

function copyMetadata(element: Element, url: string, baseHref: string | null): Element | null {
  const copy = document.createElement(element.localName);
  for (const attribute of Array.from(element.attributes)) {
    copy.setAttribute(attribute.name, attribute.value);
  }
  // This document keeps its own <base>, so a relative href is fixed to the page's.
  const href = element.getAttribute('href');
  if (href !== null) {
    const resolved = resolveMetadataHref({ href, url, baseHref });
    if (resolved === null) return null;
    copy.setAttribute('href', resolved);
  }
  return copy;
}
