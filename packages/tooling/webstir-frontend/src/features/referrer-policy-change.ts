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
 * Whether a navigation must load in full because the incoming page would get a different referrer
 * policy than the page on screen. Client-nav never switches the policy in place: removing a
 * referrer meta does not undo its policy, and Chromium applies one in a document it only parses.
 * Each side's policy is its last valid referrer meta, else its Referrer-Policy header, else none;
 * pages that set none on either side, or the same one, stay client-side. The incoming page is read
 * from its response text, before it is parsed, and a referrer meta that cannot be read for certain
 * counts as a change. `current.header` is undefined for the first load, whose header a script cannot
 * read; it is taken to match the incoming page's, as a site-wide header would.
 */
export function needsFullLoadForReferrerPolicy(options: {
  readonly incoming: { readonly header: string | null; readonly html: string };
  readonly current: {
    readonly header: string | null | undefined;
    readonly metas: readonly (string | null)[];
  };
}): boolean {
  const incomingMetas = scanReferrerMetas(options.incoming.html);
  if (incomingMetas === null) return true;
  const incoming = lastMetaPolicy(incomingMetas) ?? headerPolicy(options.incoming.header);
  const currentHeader =
    options.current.header === undefined ? options.incoming.header : options.current.header;
  const current = lastMetaPolicy(options.current.metas) ?? headerPolicy(currentHeader);
  return incoming !== current;
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
