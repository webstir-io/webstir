/** A same-origin path to return to after signing in; never another site, and never sign-in itself. */
export function safeReturnTo(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '/';
  const text = raw.trim();
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\')) return '/';
  try {
    const url = new URL(text, 'http://app.invalid');
    if (url.origin !== 'http://app.invalid') return '/';
    // Checked again after normalizing: `/.//x` and `/a/..//x` become `//x`, another site.
    const result = `${url.pathname}${url.search}${url.hash}`;
    if (result.startsWith('//') || result.includes('\\')) return '/';
    if (/^\/sign-(?:in|out)(?:\/|$)/.test(url.pathname)) return '/';
    return result;
  } catch {
    return '/';
  }
}
