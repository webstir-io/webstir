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

export const DEFAULT_REFERRER_POLICY = 'strict-origin-when-cross-origin';

/** The policy a `Referrer-Policy` header sets: its last valid token. */
export function parseReferrerPolicyHeader(value: string | null): string | null {
  let policy: string | null = null;
  for (const token of (value ?? '').split(',')) {
    const normalized = token.trim().toLowerCase();
    if (REFERRER_POLICIES.has(normalized)) policy = normalized;
  }
  return policy;
}

/** The policy a `<meta name="referrer">` content sets, legacy keywords included. */
export function parseReferrerPolicyMeta(value: string | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase();
  const policy = LEGACY_REFERRER_POLICIES[normalized] ?? normalized;
  return REFERRER_POLICIES.has(policy) ? policy : null;
}

// The document's policy as its referrer metas set it; null while none has.
let trackedPolicy: string | null = null;
let observer: MutationObserver | null = null;

/**
 * Follow the document's referrer policy the way the browser sets it: each referrer meta that goes
 * into the document, or whose content changes there, sets it, and removing one does not undo it.
 * It starts from the first load's referrer metas; that load's Referrer-Policy header cannot be read.
 */
export function trackReferrerPolicy(): void {
  if (observer) return;
  for (const meta of Array.from(document.getElementsByTagName('meta'))) note(meta, [], -1);
  observer = new MutationObserver(noteRecords);
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['name', 'content'],
  });
}

/** Set the document's policy: a referrer meta sets it when inserted and keeps it after removal. */
export function applyReferrerPolicy(value: string): void {
  const policy = document.createElement('meta');
  policy.name = 'referrer';
  policy.content = value;
  document.head.appendChild(policy);
  policy.remove();
}

/**
 * Chromium applies a referrer meta in a document parsed off screen (DOMParser) to the page on
 * screen. Until the parsed page commits, requests still come from the page on screen, so put its
 * policy back: the one its referrer metas set, else no-referrer, the one choice that cannot loosen
 * a first-load header.
 */
export function restoreReferrerPolicy(parsed: Document): void {
  if (!Array.from(parsed.getElementsByTagName('meta')).some(isReferrerMeta)) return;
  if (observer) noteRecords(observer.takeRecords());
  applyReferrerPolicy(trackedPolicy ?? 'no-referrer');
}

// Replays the records in order, each meta read as it was at that record and only while it was in
// the document, since the records arrive after the fact.
function noteRecords(records: MutationRecord[]): void {
  const detached = new Set<Node>();
  records.forEach((record, index) => {
    if (isDetached(record.target, detached)) return;
    if (record.type === 'attributes') {
      if (record.target instanceof Element) note(record.target, records, index);
      return;
    }
    for (const node of Array.from(record.removedNodes)) detached.add(node);
    for (const node of Array.from(record.addedNodes)) {
      detached.delete(node);
      if (!(node instanceof Element)) continue;
      const metas = node.localName === 'meta' ? [node] : node.getElementsByTagName('meta');
      for (const meta of Array.from(metas)) note(meta, records, index);
    }
  });
}

function note(element: Element, records: readonly MutationRecord[], index: number): void {
  if (element.localName !== 'meta') return;
  if (attributeAfter(element, 'name', records, index)?.toLowerCase() !== 'referrer') return;
  const content = attributeAfter(element, 'content', records, index) ?? undefined;
  trackedPolicy = parseReferrerPolicyMeta(content) ?? trackedPolicy;
}

// An attribute's value just after records[index]: what the next change to it found, else its value
// now.
function attributeAfter(
  element: Element,
  attribute: string,
  records: readonly MutationRecord[],
  index: number,
): string | null {
  for (const record of records.slice(index + 1)) {
    if (record.type === 'attributes' && record.target === element) {
      if (record.attributeName === attribute) return record.oldValue;
    }
  }
  return element.getAttribute(attribute);
}

function isDetached(node: Node, detached: ReadonlySet<Node>): boolean {
  for (const root of detached) if (root.contains(node)) return true;
  return false;
}

function isReferrerMeta(element: Element): boolean {
  return element.localName === 'meta' && element.getAttribute('name')?.toLowerCase() === 'referrer';
}
