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

const LEGACY_REFERRER_POLICIES: Readonly<Record<string, string>> = {
  never: 'no-referrer',
  default: 'strict-origin-when-cross-origin',
  always: 'unsafe-url',
  'origin-when-crossorigin': 'origin-when-cross-origin',
};

const DEFAULT_REFERRER_POLICY = 'strict-origin-when-cross-origin';

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
  for (const index of add) {
    const { attributes } = options.next[index]!;
    if (attributes.name?.trim().toLowerCase() !== 'referrer') continue;
    referrerPolicy = parseReferrerPolicyMeta(attributes.content) ?? referrerPolicy;
  }
  return { remove, add, referrerPolicy: referrerPolicy ?? DEFAULT_REFERRER_POLICY };
}

/** Replace the current page's metadata in `<head>` with `doc`'s, fetched from `url`. */
export function syncHeadMetadata(
  doc: Document,
  url: string,
  referrerPolicyHeader: string | null,
): void {
  const head = document.head;
  const newHead = doc.head;
  if (!head || !newHead) return;

  const current = headMetadataCandidates(head);
  const next = headMetadataCandidates(newHead);
  const sync = resolveHeadMetadataSync({
    current: current.map(describe),
    next: next.map(describe),
    referrerPolicyHeader,
  });

  for (const index of sync.remove) current[index]!.remove();
  for (const index of sync.add) head.appendChild(copyMetadata(next[index]!, url));

  // A referrer meta sets the policy when it is inserted and keeps it after it is removed.
  const policy = document.createElement('meta');
  policy.name = 'referrer';
  policy.content = sync.referrerPolicy;
  head.appendChild(policy);
  policy.remove();
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

function copyMetadata(element: Element, url: string): Element {
  const copy = document.createElement(element.localName);
  for (const attribute of Array.from(element.attributes)) {
    copy.setAttribute(attribute.name, attribute.value);
  }
  // The copy lands before the address changes, so a relative href must not resolve against it.
  const href = element.getAttribute('href');
  if (href !== null) {
    try {
      copy.setAttribute('href', new URL(href, url).href);
    } catch {
      copy.removeAttribute('href');
    }
  }
  return copy;
}
