/**
 * Bun.serve() full demo proof of concept.
 *
 * What worked in the March 16, 2026 verification run:
 * - Frontend HTML routing works when Bun owns a standalone full HTML document.
 * - Frontend CSS edits hot-apply through Bun's injected dev client, and this
 *   script logs a probe timing for the first HTML request after each change.
 * - API/document routes respond correctly for GET, POST, fragment responses,
 *   redirects, and cookie-backed session flows.
 * - Session management works in-process with `bun:sqlite`; the demo keeps a
 *   server-side session row keyed by a cookie, and sign-in/sign-out flows work
 *   across requests.
 *
 * What did not map cleanly:
 * - The existing demo frontend HTML is not directly Bun-route-ready. Webstir's
 *   current pipeline composes `src/frontend/app/app.html` with page fragments,
 *   so this POC adds a Bun-owned HTML entrypoint beside the script.
 * - Bun's HTML route only owns the static frontend document. The backend-served
 *   HTML route still has to discover the current Bun-generated asset URLs so it
 *   can reuse the same dev bundle.
 * - This does not replace Webstir's current watch decisions, esbuild metafile
 *   diffing, or custom HMR/reload fallback logic. It only proves Bun can host
 *   this demo directly.
 *
 * Observed limitations:
 * - Frontend JavaScript edits triggered a full page reload in the browser, not
 *   a state-preserving hot module swap. Bun logged that the changed modules do
 *   not call `import.meta.hot.accept`, which matches the current demo's custom
 *   Webstir HMR hooks instead of Bun-native acceptance.
 * - The timing probe measures end-to-end latency of the first HTML request
 *   after a frontend file change. It is a practical proxy for "rebundle after a
 *   change", not an internal Bun compiler metric.
 * - The SQLite session store lives for the life of this process. Restarting the
 *   POC clears sessions.
 */

import { watch } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { Database } from 'bun:sqlite';

import homePage from './bun-serve-poc.home.html';

const workspaceRoot = import.meta.dir;
const frontendRoot = path.join(workspaceRoot, 'src', 'frontend');
const sessionCookieName = 'webstir_demo_session';
const demoPath = '/demo/progressive-enhancement';
const demoApiPath = `/api${demoPath}`;
const fragmentTarget = 'greeting-preview';
const sessionPanelTarget = 'session-panel';
const startedAt = performance.now();

const db = new Database(':memory:');
db.exec(`
  create table if not exists sessions (
    id text primary key,
    name text not null,
    created_at integer not null
  );
`);

const insertSession = db.query('insert into sessions (id, name, created_at) values (?, ?, ?)');
const selectSession = db.query('select name from sessions where id = ? limit 1');
const deleteSession = db.query('delete from sessions where id = ?');

type SessionState = 'signed-in' | 'signed-out' | 'none';
type GreetingSource = 'baseline' | 'redirect' | 'fragment';
type SessionPanelState = 'baseline' | 'signed-in' | 'signed-out' | 'fragment';
type FragmentMode = 'replace' | 'append' | 'prepend';

interface RouteResult {
  status?: number;
  headers?: HeadersInit;
  body?: BodyInit | null;
  redirect?: string;
  fragment?: {
    target: string;
    selector?: string;
    mode?: FragmentMode;
    body: string;
  };
}

interface FrontendAssets {
  cssHrefs: readonly string[];
  scriptSrc: string;
}

let server: Bun.Server | undefined;
let cachedAssets: FrontendAssets | null = null;
let pendingProbeChange: string | null = null;
let pendingProbeTimer: ReturnType<typeof setTimeout> | undefined;

const routes: Bun.ServeOptions['routes'] = {
  '/': homePage,
  '/Errors.default.html': Bun.file(path.join(workspaceRoot, 'Errors.default.html')),
  '/Errors.404.html': Bun.file(path.join(workspaceRoot, 'Errors.404.html')),
  '/Errors.500.html': Bun.file(path.join(workspaceRoot, 'Errors.500.html')),
};

server = Bun.serve({
  development: true,
  port: Number(process.env.PORT || 4002),
  routes,
  fetch(request) {
    return handleRequest(request);
  },
});

console.info(`[bun-serve-poc] listening on ${server.url}`);
console.info(`[bun-serve-poc] startup ${(performance.now() - startedAt).toFixed(1)}ms`);

queueMicrotask(() => {
  void refreshFrontendAssets('startup');
});

const closeFrontendWatcher = watch(
  frontendRoot,
  { recursive: true },
  (_eventType, filename) => {
    if (typeof filename !== 'string' || filename.length === 0) {
      return;
    }

    if (!/\.(?:html|css|js|jsx|ts|tsx)$/.test(filename)) {
      return;
    }

    cachedAssets = null;
    pendingProbeChange = filename;
    if (pendingProbeTimer) {
      clearTimeout(pendingProbeTimer);
    }

    pendingProbeTimer = setTimeout(() => {
      const changedFile = pendingProbeChange;
      pendingProbeChange = null;
      pendingProbeTimer = undefined;
      if (!changedFile) {
        return;
      }

      void probeFrontendRebundle(changedFile);
    }, 150);
  }
);

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function shutdown(): Promise<void> {
  closeFrontendWatcher.close();
  if (pendingProbeTimer) {
    clearTimeout(pendingProbeTimer);
    pendingProbeTimer = undefined;
  }
  db.close(false);
  server?.stop(true);
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/health') {
    return Response.json({
      ok: true,
      uptimeSeconds: process.uptime(),
    });
  }

  if (url.pathname === '/favicon.ico') {
    return new Response(null, { status: 204 });
  }

  if (url.pathname === demoPath || url.pathname === demoApiPath) {
    if (request.method === 'GET') {
      return await handleDemoPage(request, url);
    }

    if (request.method === 'POST') {
      return await handleGreetingSubmit(request);
    }
  }

  if (
    url.pathname === `${demoPath}/session/sign-in`
    || url.pathname === `${demoApiPath}/session/sign-in`
  ) {
    if (request.method === 'POST') {
      return await handleSessionSignIn(request);
    }
  }

  if (
    url.pathname === `${demoPath}/session/sign-out`
    || url.pathname === `${demoApiPath}/session/sign-out`
  ) {
    if (request.method === 'POST') {
      return await handleSessionSignOut(request);
    }
  }

  return new Response('Not found', { status: 404 });
}

async function handleDemoPage(request: Request, url: URL): Promise<Response> {
  const source = url.searchParams.get('source') === 'redirect' ? 'redirect' : 'baseline';
  const name = readQueryValue(url.searchParams, 'name', 'Webstir');
  const sessionState = readSessionState(url.searchParams);
  const sessionName = readSessionName(request);
  const assets = await getFrontendAssets();

  return htmlResponse(
    renderDemoPage({
      name,
      source,
      sessionName,
      sessionState,
      assets,
    })
  );
}

async function handleGreetingSubmit(request: Request): Promise<Response> {
  const body = await readFormBody(request);
  const name = readBodyValue(body, 'name', 'Webstir');
  const basePath = resolveDemoBasePath(request);

  if (isEnhancedRequest(request)) {
    return routeResponse({
      fragment: {
        target: fragmentTarget,
        selector: `#${fragmentTarget}`,
        mode: 'replace',
        body: renderGreeting(name, 'fragment'),
      },
    });
  }

  return routeResponse({
    status: 303,
    redirect: `${basePath}?source=redirect&name=${encodeURIComponent(name)}`,
  });
}

async function handleSessionSignIn(request: Request): Promise<Response> {
  const body = await readFormBody(request);
  const sessionName = readBodyValue(body, 'sessionName', 'Webstir User');
  const basePath = resolveDemoBasePath(request);
  const sessionId = crypto.randomUUID();
  insertSession.run(sessionId, sessionName, Date.now());
  const headers = new Headers({
    'set-cookie': createSessionCookie(sessionId),
  });

  if (isEnhancedRequest(request)) {
    return routeResponse({
      headers,
      fragment: {
        target: sessionPanelTarget,
        selector: `#${sessionPanelTarget}`,
        mode: 'replace',
        body: renderSessionPanel(sessionName, 'fragment'),
      },
    });
  }

  return routeResponse({
    status: 303,
    headers,
    redirect: `${basePath}?session=signed-in`,
  });
}

async function handleSessionSignOut(request: Request): Promise<Response> {
  const basePath = resolveDemoBasePath(request);
  const sessionId = readCookie(request, sessionCookieName);
  if (sessionId) {
    deleteSession.run(sessionId);
  }

  const headers = new Headers({
    'set-cookie': clearSessionCookie(),
  });

  if (isEnhancedRequest(request)) {
    return routeResponse({
      headers,
      fragment: {
        target: sessionPanelTarget,
        selector: `#${sessionPanelTarget}`,
        mode: 'replace',
        body: renderSessionPanel(null, 'fragment'),
      },
    });
  }

  return routeResponse({
    status: 303,
    headers,
    redirect: `${basePath}?session=signed-out`,
  });
}

function resolveDemoBasePath(request: Request): string {
  return new URL(request.url).pathname.startsWith('/api/') ? demoApiPath : demoPath;
}

function routeResponse(result: RouteResult): Response {
  const status = result.redirect ? (result.status ?? 303) : (result.status ?? 200);
  const headers = new Headers(result.headers);

  if (result.redirect) {
    headers.set('location', result.redirect);
  }

  let body = result.body ?? null;
  if (result.fragment) {
    headers.set('x-webstir-fragment-target', result.fragment.target);
    if (result.fragment.selector) {
      headers.set('x-webstir-fragment-selector', result.fragment.selector);
    }
    if (result.fragment.mode) {
      headers.set('x-webstir-fragment-mode', result.fragment.mode);
    }
    body = result.fragment.body;
  }

  if (body && !headers.has('content-type')) {
    headers.set(
      'content-type',
      typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json'
    );
  }

  if (result.redirect || body === null) {
    return new Response(null, { status, headers });
  }

  if (typeof body === 'string' || body instanceof Blob || body instanceof ArrayBuffer) {
    return new Response(body, { status, headers });
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function htmlResponse(body: string, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  return new Response(body, { ...init, headers });
}

async function readFormBody(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await request.text());
    return Object.fromEntries(params.entries());
  }

  if (contentType.toLowerCase().includes('multipart/form-data')) {
    const formData = await request.formData();
    return Object.fromEntries(
      Array.from(formData.entries()).map(([key, value]) => [key, String(value)])
    );
  }

  return {};
}

function readBodyValue(
  body: Record<string, string>,
  key: string,
  fallback: string
): string {
  const normalized = String(body[key] ?? '').trim();
  return normalized || fallback;
}

function readQueryValue(searchParams: URLSearchParams, key: string, fallback: string): string {
  const normalized = String(searchParams.get(key) ?? '').trim();
  return normalized || fallback;
}

function readSessionState(searchParams: URLSearchParams): SessionState {
  const normalized = String(searchParams.get('session') ?? '').trim().toLowerCase();
  if (normalized === 'signed-in' || normalized === 'signed-out') {
    return normalized;
  }
  return 'none';
}

function isEnhancedRequest(request: Request): boolean {
  return request.headers.get('x-webstir-client-nav') === '1';
}

function readSessionName(request: Request): string | null {
  const sessionId = readCookie(request, sessionCookieName);
  if (!sessionId) {
    return null;
  }

  const session = selectSession.get(sessionId) as { name: string } | null;
  return session?.name ?? null;
}

function readCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) {
    return null;
  }

  for (const part of raw.split(';')) {
    const [rawName, ...valueParts] = part.trim().split('=');
    if (rawName === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }

  return null;
}

function createSessionCookie(sessionId: string): string {
  return [
    `${sessionCookieName}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
}

function clearSessionCookie(): string {
  return [
    `${sessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderGreeting(name: string, source: GreetingSource): string {
  const escapedName = escapeHtml(name);
  const message =
    source === 'redirect'
      ? 'The browser completed a full-page redirect after the form POST.'
      : source === 'fragment'
        ? 'JavaScript enhancement can replace just this region without a full reload.'
        : 'Submit the form with or without JavaScript to compare the two flows.';
  const focusBadge =
    source === 'fragment'
      ? '  <button type="button" id="greeting-update-focus" class="chip" autofocus>Greeting updated</button>\n'
      : '';

  return [
    `<section id="${fragmentTarget}" data-webstir-fragment-target="${fragmentTarget}" aria-live="polite">`,
    focusBadge.trimEnd(),
    `  <h2>Hello, ${escapedName}</h2>`,
    `  <p>${message}</p>`,
    '</section>',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderSessionPanel(
  sessionName: string | null,
  state: SessionPanelState
): string {
  const escapedSessionName = sessionName ? escapeHtml(sessionName) : null;
  const status = sessionName
    ? state === 'signed-in'
      ? `Signed in as <strong>${escapedSessionName}</strong> via the no-JavaScript redirect path.`
      : `Signed in as <strong>${escapedSessionName}</strong>. Reload the page to confirm the session persists.`
    : state === 'signed-out'
      ? 'Signed out via the no-JavaScript redirect path.'
      : state === 'fragment'
        ? 'Signed out without a full page reload.'
        : 'Not signed in. Submit the form to create a cookie-backed session.';

  if (sessionName) {
    return [
      `<section id="${sessionPanelTarget}" data-webstir-fragment-target="${sessionPanelTarget}" aria-live="polite" class="card stack">`,
      '  <h2>Session demo</h2>',
      `  <p class="status" id="session-status">${status}</p>`,
      `  <p id="session-user" data-session-user="${escapedSessionName}">${escapedSessionName}</p>`,
      `  <form method="post" action="./progressive-enhancement/session/sign-out">`,
      '    <button id="demo-sign-out" type="submit">Sign out</button>',
      '  </form>',
      '</section>',
    ].join('\n');
  }

  return [
    `<section id="${sessionPanelTarget}" data-webstir-fragment-target="${sessionPanelTarget}" aria-live="polite" class="card stack">`,
    '  <h2>Session demo</h2>',
    `  <p class="status" id="session-status">${status}</p>`,
    `  <form method="post" action="./progressive-enhancement/session/sign-in" class="stack">`,
    '    <label for="session-name">Session name</label>',
    '    <input id="session-name" name="sessionName" value="Webstir User" autocomplete="username" />',
    '    <button id="demo-sign-in" type="submit">Sign in</button>',
    '  </form>',
    '</section>',
  ].join('\n');
}

function renderDemoPage(options: {
  name: string;
  source: 'baseline' | 'redirect';
  sessionName: string | null;
  sessionState: SessionState;
  assets: FrontendAssets;
}): string {
  const { assets, name, sessionName, sessionState, source } = options;
  const escapedName = escapeHtml(name);
  const status =
    source === 'redirect'
      ? '<p class="status">Last submit used the no-JavaScript redirect path.</p>'
      : '<p class="status">This page is ready for progressive enhancement via <code>client-nav</code>.</p>';
  const sessionPanelState = sessionName
    ? sessionState === 'signed-in'
      ? 'signed-in'
      : 'baseline'
    : sessionState === 'signed-out'
      ? 'signed-out'
      : 'baseline';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Progressive Enhancement Demo</title>
  ${assets.cssHrefs
    .map((href) => `  <link rel="stylesheet" href="${href}" />`)
    .join('\n')}
  <style>
    body { background: #f6f7f3; color: #132019; }
    main { max-width: 52rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
    .stack { display: grid; gap: 1.25rem; }
    .card { background: #fffdf8; border: 1px solid #d7dfd4; border-radius: 1rem; padding: 1.25rem; box-shadow: 0 1rem 2rem rgba(19, 32, 25, 0.06); }
    .status { color: #456152; margin: 0; }
    .chip { width: fit-content; padding: 0.4rem 0.75rem; border: 1px solid #b8c5b7; border-radius: 999px; background: #edf3e9; color: #1d6b45; }
    form { display: grid; gap: 0.75rem; }
    label { font-weight: 600; }
    input, button { font: inherit; }
    input { padding: 0.75rem 0.9rem; border: 1px solid #b8c5b7; border-radius: 0.75rem; }
    button { width: fit-content; padding: 0.75rem 1rem; border: 0; border-radius: 999px; background: #1d6b45; color: white; cursor: pointer; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
  <script type="module" crossorigin src="${assets.scriptSrc}"></script>
</head>
<body>
  <main class="stack">
    <header class="stack">
      <p><a href="/">Back to the Bun.serve() POC home page</a></p>
      <div class="stack">
        <h1>Progressive enhancement form flow</h1>
        <p>This route is served directly by the same Bun server process. The form still works without client JavaScript, and <code>client-nav</code> upgrades it to a fragment update when available.</p>
        ${status}
      </div>
    </header>
    ${renderSessionPanel(sessionName, sessionPanelState)}
    <section class="card stack">
      <form id="greeting-form" method="post">
        <label for="demo-name">Name</label>
        <input id="demo-name" name="name" value="${escapedName}" autocomplete="name" autofocus />
        <button id="demo-update-greeting" type="submit">Update greeting</button>
      </form>
      ${renderGreeting(name, source)}
    </section>
  </main>
</body>
</html>`;
}

async function getFrontendAssets(): Promise<FrontendAssets> {
  if (cachedAssets) {
    return cachedAssets;
  }

  return await refreshFrontendAssets('asset-request');
}

async function refreshFrontendAssets(reason: string): Promise<FrontendAssets> {
  if (!server) {
    throw new Error('Server is not ready yet.');
  }

  const response = await fetch(new URL('/', server.url), {
    headers: {
      'x-webstir-poc-probe': reason,
    },
  });
  const html = await response.text();
  const cssHrefs = Array.from(
    html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
    (match) => match[1]
  );
  const scriptSrc = html.match(/<script[^>]*src="([^"]+)"[^>]*data-bun-dev-server-script[^>]*><\/script>/)?.[1];

  if (!scriptSrc) {
    throw new Error('Could not discover Bun dev script from the home route.');
  }

  cachedAssets = {
    cssHrefs,
    scriptSrc,
  };

  return cachedAssets;
}

async function probeFrontendRebundle(changedFile: string): Promise<void> {
  if (!server) {
    return;
  }

  const started = performance.now();
  const response = await fetch(new URL('/', server.url), {
    headers: {
      'x-webstir-poc-probe': `frontend-change:${changedFile}`,
      'cache-control': 'no-cache',
    },
  });
  await response.text();
  const duration = performance.now() - started;
  console.info(
    `[bun-serve-poc] frontend probe ${duration.toFixed(1)}ms after ${changedFile}`
  );
  await refreshFrontendAssets(`frontend-change:${changedFile}`);
}
