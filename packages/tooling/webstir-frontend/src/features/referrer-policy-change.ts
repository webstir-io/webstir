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

// Markup a browser never reads as elements: comments (abruptly closed and unterminated ones
// included) and raw-text elements, matched left to right as the tokenizer meets them. `<noscript>`
// is kept, since a parser without scripting reads its contents as elements.
const INERT_MARKUP =
  /<!--(?:>|->|[\s\S]*?(?:--!?>|$))|<(script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)\b[^>]*>[\s\S]*?(?:<\/\1(?=[\s/>])|$)/gi;

// A `<meta ...>` tag, quoted attribute values included, and the attributes inside it.
const META_TAG = /<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
// Any meta whose name looks like referrer, read to the first `>`: a check on the tag reading above.
const META_TAG_LOOSE = /<meta\b[^>]*name\s*=\s*["']?referrer/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * The page on screen, for its referrer policy: `committed` is the policy the last client
 * navigation kept (null for none), or undefined on the first load, whose Referrer-Policy header a
 * script cannot read; `metas` are the contents of the referrer metas in the document now.
 */
export interface OnScreenReferrerPolicy {
  readonly committed: string | null | undefined;
  readonly metas: readonly (string | null)[];
}

export type ReferrerPolicyNavigation =
  | { readonly kind: 'render'; readonly policy: string | null }
  | { readonly kind: 'load' };

/**
 * Whether a fetched page can render in place or must load in full because it would get a different
 * referrer policy than the page on screen. Client-nav never switches the policy in place: removing
 * a referrer meta does not undo its policy, and Chromium applies one in a document it only parses.
 * A page's policy is its last valid referrer meta, else its Referrer-Policy header, else none; pages
 * that set none on either side, or the same one, render in place, and the policy they share is
 * returned for the page on screen to keep. The incoming page is read from its response text, before
 * it is parsed, and a referrer meta that cannot be read for certain means a full load. The first
 * load's header is taken to match the incoming page's, as a site-wide header would.
 */
export function resolveReferrerPolicyNavigation(options: {
  readonly incoming: { readonly header: string | null; readonly html: string };
  readonly current: OnScreenReferrerPolicy;
}): ReferrerPolicyNavigation {
  const incomingMetas = scanReferrerMetas(options.incoming.html);
  if (incomingMetas === null) return { kind: 'load' };
  const incoming = lastMetaPolicy(incomingMetas) ?? headerPolicy(options.incoming.header);
  const current = onScreenReferrerPolicy(options.current, options.incoming.header);
  return incoming === current ? { kind: 'render', policy: incoming } : { kind: 'load' };
}

/**
 * The page on screen's policy: its last valid referrer meta, else the one the last client
 * navigation kept, else, on the first load, the policy `assumedHeader` would set.
 */
export function onScreenReferrerPolicy(
  current: OnScreenReferrerPolicy,
  assumedHeader: string | null,
): string | null {
  const committed =
    current.committed === undefined ? headerPolicy(assumedHeader) : current.committed;
  return lastMetaPolicy(current.metas) ?? committed;
}

/** The content of each referrer meta in `doc`, in document order. */
export function readReferrerMetas(doc: Document): (string | null)[] {
  return Array.from(doc.getElementsByTagName('meta'))
    .filter((meta) => meta.getAttribute('name')?.toLowerCase() === 'referrer')
    .map((meta) => meta.getAttribute('content'));
}

// The content of each referrer meta in `html`, or null when one might be there but cannot be read.
function scanReferrerMetas(source: string): (string | null)[] | null {
  const html = source.replace(INERT_MARKUP, ' ');
  const contents: (string | null)[] = [];
  for (const [, inside = ''] of html.matchAll(META_TAG)) {
    const attributes = new Map<string, string>();
    for (const [, name = '', double, single, bare] of inside.matchAll(ATTRIBUTE)) {
      const key = name.toLowerCase();
      if (!attributes.has(key)) attributes.set(key, double ?? single ?? bare ?? '');
    }
    const name = attributes.get('name');
    if (name === undefined) continue;
    if (name.includes('&')) return null;
    if (name.toLowerCase() !== 'referrer') continue;
    const content = attributes.get('content') ?? null;
    if (content?.includes('&')) return null;
    contents.push(content);
  }
  const loose = Array.from(html.matchAll(META_TAG_LOOSE)).length;
  return loose > contents.length ? null : contents;
}

function lastMetaPolicy(contents: readonly (string | null)[]): string | null {
  let policy: string | null = null;
  for (const content of contents) {
    const normalized = (content ?? '').trim().toLowerCase();
    const candidate = LEGACY_REFERRER_POLICIES[normalized] ?? normalized;
    if (REFERRER_POLICIES.has(candidate)) policy = candidate;
  }
  return policy;
}

function headerPolicy(value: string | null): string | null {
  let policy: string | null = null;
  for (const token of (value ?? '').split(',')) {
    const normalized = token.trim().toLowerCase();
    if (REFERRER_POLICIES.has(normalized)) policy = normalized;
  }
  return policy;
}
