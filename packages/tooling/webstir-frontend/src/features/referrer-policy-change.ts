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

// Elements whose contents a browser reads as text, not markup. `<noscript>` is not one here: a
// parser without scripting, as DOMParser is, reads its contents as elements.
const RAW_TEXT_ELEMENTS = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);
const TAG_NAME_START = /[a-z]/i;
const SPACE = /[\t\n\f\r ]/;

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

/**
 * The content of each referrer meta in `html`, or null when one might be there but cannot be read
 * (its name or content written with a character reference). It follows the HTML tokenizer closely
 * enough to skip what is not an element: comments, doctypes and other `<!`/`<?` markup, end tags,
 * attribute values, and the contents of raw-text elements.
 */
function scanReferrerMetas(html: string): (string | null)[] | null {
  const contents: (string | null)[] = [];
  let index = html.indexOf('<');
  while (index !== -1) {
    let next = index + 1;
    if (html.startsWith('<!--', index)) {
      next = commentEnd(html, index + 4);
    } else if (html[index + 1] === '!' || html[index + 1] === '?') {
      next = afterNext(html, '>', index + 2);
    } else {
      const closing = html[index + 1] === '/';
      const start = index + (closing ? 2 : 1);
      if (TAG_NAME_START.test(html[start] ?? '')) {
        const tag = readTag(html, start);
        if (!tag) break;
        next = tag.end;
        if (!closing && RAW_TEXT_ELEMENTS.has(tag.name)) {
          next = rawTextEnd(html, tag.name, next);
        } else if (!closing && tag.name === 'meta') {
          const name = tag.attributes.get('name');
          if (name?.includes('&')) return null;
          if (name?.toLowerCase() === 'referrer') {
            const content = tag.attributes.get('content') ?? null;
            if (content?.includes('&')) return null;
            contents.push(content);
          }
        }
      }
    }
    index = html.indexOf('<', next);
  }
  return contents;
}

// A start or end tag from its name at `start`: its lowercase name, its attributes (the first of
// each name), and where it ends; null when the document ends inside it, which drops it.
function readTag(
  html: string,
  start: number,
): { name: string; attributes: Map<string, string>; end: number } | null {
  let index = skip(html, start, (char) => !SPACE.test(char) && char !== '/' && char !== '>');
  const name = html.slice(start, index).toLowerCase();
  const attributes = new Map<string, string>();
  while (index < html.length) {
    const char = html.charAt(index);
    if (SPACE.test(char) || char === '/') {
      index++;
      continue;
    }
    if (char === '>') return { name, attributes, end: index + 1 };
    const nameStart = index;
    index = skip(html, index + 1, (c) => !SPACE.test(c) && c !== '/' && c !== '>' && c !== '=');
    const attribute = html.slice(nameStart, index).toLowerCase();
    let value = '';
    const after = skip(html, index, (c) => SPACE.test(c));
    if (html[after] === '=') {
      index = skip(html, after + 1, (c) => SPACE.test(c));
      const quote = html[index];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, index + 1);
        if (close === -1) return null;
        value = html.slice(index + 1, close);
        index = close + 1;
      } else {
        const valueStart = index;
        index = skip(html, index, (c) => !SPACE.test(c) && c !== '>');
        value = html.slice(valueStart, index);
      }
    }
    if (!attributes.has(attribute)) attributes.set(attribute, value);
  }
  return null;
}

// Where a comment whose text starts at `start` ends, abruptly closed ones included.
function commentEnd(html: string, start: number): number {
  if (html[start] === '>') return start + 1;
  if (html.startsWith('->', start)) return start + 2;
  const close = /--!?>/g;
  close.lastIndex = start;
  const match = close.exec(html);
  return match ? match.index + match[0].length : html.length;
}

// Where a raw-text element's contents end: at its end tag, or the end of the document.
function rawTextEnd(html: string, name: string, start: number): number {
  if (name === 'plaintext') return html.length;
  const endTag = new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'gi');
  endTag.lastIndex = start;
  const match = endTag.exec(html);
  return match ? match.index : html.length;
}

function skip(html: string, start: number, keep: (char: string) => boolean): number {
  let index = start;
  while (index < html.length && keep(html.charAt(index))) index++;
  return index;
}

function afterNext(html: string, char: string, start: number): number {
  const found = html.indexOf(char, start);
  return found === -1 ? html.length : found + 1;
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
