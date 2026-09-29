import { FILES } from '../core/constants.js';

const DEV_CLIENTS = [
  { src: `/${FILES.hmrJs}`, tag: `<script type="module" src="/${FILES.hmrJs}"></script>` },
  { src: `/${FILES.refreshJs}`, tag: `<script src="/${FILES.refreshJs}" async></script>` },
];

/**
 * A page built for development carries Webstir's live-update and reload clients, whether or not
 * the app's shell names them; publish strips them again.
 */
export function withDevClients(html: string): string {
  const missing = DEV_CLIENTS.filter(
    ({ src }) =>
      !new RegExp(`<script\\b[^>]*\\bsrc=["']${src.replace('.', '\\.')}["']`, 'i').test(html),
  );
  if (missing.length === 0) return html;
  const tags = missing.map(({ tag }) => tag).join('\n');
  const end = html.toLowerCase().lastIndexOf('</body>');
  return end === -1 ? `${html}\n${tags}` : `${html.slice(0, end)}${tags}\n${html.slice(end)}`;
}

/** Every page loads the app bundle when the app has one; a shell that names it keeps its own tag. */
export function withAppBundle(html: string, hasBundle: boolean): string {
  if (!hasBundle || /<script\b[^>]*\bsrc=["']\/app\/app\.js["']/i.test(html)) return html;
  const tag = '<script type="module" src="/app/app.js"></script>';
  const end = html.toLowerCase().indexOf('</head>');
  return end === -1 ? `${tag}\n${html}` : `${html.slice(0, end)}${tag}\n${html.slice(end)}`;
}

/**
 * Every page links the app's styles when it has any, ahead of its own stylesheets; a shell that
 * links them keeps its own tag.
 */
export function withAppStyles(html: string, hasStyles: boolean): string {
  if (!hasStyles || /<link\b[^>]*\bhref=["']\/app\/app\.css["']/i.test(html)) return html;
  const tag = '<link rel="stylesheet" href="/app/app.css">';
  const lower = html.toLowerCase();
  const head = lower.indexOf('</head>');
  const firstStylesheet = lower.search(/<link\b[^>]*\brel=["']?stylesheet/);
  const at =
    firstStylesheet !== -1 && (head === -1 || firstStylesheet < head) ? firstStylesheet : head;
  return at === -1 ? `${tag}\n${html}` : `${html.slice(0, at)}${tag}\n${html.slice(at)}`;
}
