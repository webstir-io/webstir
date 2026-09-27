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

// The policy of the page on screen as client-nav knows it: what the last navigation committed, or
// the first load's referrer metas. Null when unknown: the first load had none, and its
// Referrer-Policy header cannot be read, or the page's own code has since changed a referrer meta.
let knownPolicy: string | null = null;
let observer: MutationObserver | null = null;

/** Start following the page's referrer policy: from the first load's referrer metas, if any. */
export function trackReferrerPolicy(): void {
  if (observer) return;
  knownPolicy = lastReferrerPolicy(document);
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
 * Record the policy a client navigation just committed: `applied`, then any referrer meta in the
 * `content` it put in. Call it right after the content goes in, in the same task.
 */
export function commitReferrerPolicy(applied: string, content: Element | null): void {
  observer?.takeRecords();
  knownPolicy = (content && lastReferrerPolicy(content)) ?? applied;
}

/**
 * Chromium applies a referrer meta in a document parsed off screen (DOMParser) to the page on
 * screen. Until the parsed page commits, requests still come from the page on screen, so put its
 * policy back, or no-referrer when it is unknown: the one choice that cannot loosen it.
 */
export function restoreReferrerPolicy(parsed: Document): void {
  if (!Array.from(parsed.getElementsByTagName('meta')).some(isReferrerMeta)) return;
  if (observer) noteRecords(observer.takeRecords());
  applyReferrerPolicy(knownPolicy ?? 'no-referrer');
}

// Mutation records arrive after the fact and cannot say what a meta held when the browser read it,
// so once the page's own code touches a referrer meta, its policy is no longer known.
function noteRecords(records: MutationRecord[]): void {
  if (records.some(touchesReferrerMeta)) knownPolicy = null;
}

function touchesReferrerMeta(record: MutationRecord): boolean {
  if (record.type === 'attributes') {
    return (
      isReferrerMeta(record.target) ||
      (record.attributeName === 'name' && record.oldValue?.toLowerCase() === 'referrer')
    );
  }
  return [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some(
    (node) =>
      isReferrerMeta(node) ||
      (node instanceof Element &&
        Array.from(node.getElementsByTagName('meta')).some(isReferrerMeta)),
  );
}

function lastReferrerPolicy(root: Document | Element): string | null {
  let policy: string | null = null;
  for (const meta of Array.from(root.getElementsByTagName('meta'))) {
    if (!isReferrerMeta(meta)) continue;
    policy = parseReferrerPolicyMeta(meta.getAttribute('content') ?? undefined) ?? policy;
  }
  return policy;
}

function isReferrerMeta(node: Node): boolean {
  return (
    node instanceof Element &&
    node.localName === 'meta' &&
    node.getAttribute('name')?.toLowerCase() === 'referrer'
  );
}
