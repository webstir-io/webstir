import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RouteHandlerResult } from '@webstir-io/webstir-backend/runtime/bun';

const ROOT_PATH = '/';
const DEMO_PATH = '/demo/progressive-enhancement';
const FRAGMENT_TARGET = 'greeting-preview';
const SESSION_PANEL_TARGET = 'session-panel';
const SESSION_COOKIE_NAME = 'webstir_demo_session';
const SESSION_SIGN_IN_ACTION = './progressive-enhancement/session/sign-in';
const SESSION_SIGN_OUT_ACTION = './progressive-enhancement/session/sign-out';
const DEV_FRONTEND_ASSETS = {
  cssHref: '/src/frontend/app/app.css',
  scriptSrc: '/src/frontend/app/app.ts',
} as const;

type BunCookieMapInstance = {
  get(name: string): string | null;
  set(options: {
    name: string;
    value: string;
    path?: string;
    httpOnly?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
    maxAge?: number;
    expires?: Date | number | string;
  }): void;
  toSetCookieHeaders(): string[];
};

type BunCookieMapConstructor = new (
  init?: string[][] | Record<string, string> | string
) => BunCookieMapInstance;

type BunRuntime = {
  CookieMap?: BunCookieMapConstructor;
};

interface RouteMatch {
  readonly name: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly summary: string;
  readonly interaction?: 'navigation' | 'mutation';
  readonly form?: {
    readonly contentType: 'application/x-www-form-urlencoded';
  };
  readonly fragment?: {
    readonly target: string;
    readonly selector?: string;
    readonly mode?: 'replace' | 'append' | 'prepend';
  };
}

interface RouteContext {
  readonly request: Request;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

interface DemoRoute {
  readonly definition: RouteMatch;
  readonly handler: (context: RouteContext) => Promise<RouteHandlerResult> | RouteHandlerResult;
}

function readSubmittedName(body: unknown): string {
  return readSubmittedText(body, 'name', 'Webstir');
}

function readSubmittedSessionName(body: unknown): string {
  return readSubmittedText(body, 'sessionName', 'Webstir User');
}

function readSubmittedText(body: unknown, key: string, fallback: string): string {
  if (!body || typeof body !== 'object') {
    return fallback;
  }

  const rawValue = (body as Record<string, unknown>)[key];
  const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
  return normalized || fallback;
}

function readQueryName(query: Record<string, string>): string {
  const normalized = String(query.name ?? '').trim();
  return normalized || 'Webstir';
}

function readSessionQueryState(query: Record<string, string>): 'signed-in' | 'signed-out' | 'none' {
  const normalized = String(query.session ?? '').trim().toLowerCase();
  if (normalized === 'signed-in' || normalized === 'signed-out') {
    return normalized;
  }
  return 'none';
}

function isEnhancedRequest(request: Request): boolean {
  return request.headers.get('x-webstir-client-nav') === '1';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderGreeting(name: string, source: 'baseline' | 'redirect' | 'fragment'): string {
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
    `<section id="${FRAGMENT_TARGET}" data-webstir-fragment-target="${FRAGMENT_TARGET}" aria-live="polite">`,
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
  state: 'baseline' | 'signed-in' | 'signed-out' | 'fragment',
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
      `<section id="${SESSION_PANEL_TARGET}" data-webstir-fragment-target="${SESSION_PANEL_TARGET}" aria-live="polite" class="card stack">`,
      '  <h2>Session demo</h2>',
      `  <p class="status" id="session-status">${status}</p>`,
      `  <p id="session-user" data-session-user="${escapedSessionName}">${escapedSessionName}</p>`,
      `  <form method="post" action="${SESSION_SIGN_OUT_ACTION}">`,
      '    <button id="demo-sign-out" type="submit">Sign out</button>',
      '  </form>',
      '</section>',
    ].join('\n');
  }

  return [
    `<section id="${SESSION_PANEL_TARGET}" data-webstir-fragment-target="${SESSION_PANEL_TARGET}" aria-live="polite" class="card stack">`,
    '  <h2>Session demo</h2>',
    `  <p class="status" id="session-status">${status}</p>`,
    `  <form method="post" action="${SESSION_SIGN_IN_ACTION}" class="stack">`,
    '    <label for="session-name">Session name</label>',
    '    <input id="session-name" name="sessionName" value="Webstir User" autocomplete="username" />',
    '    <button id="demo-sign-in" type="submit">Sign in</button>',
    '  </form>',
    '</section>',
  ].join('\n');
}

function renderDemoPage(
  name: string,
  source: 'baseline' | 'redirect',
  sessionName: string | null,
  sessionState: 'signed-in' | 'signed-out' | 'none',
): string {
  const escapedName = escapeHtml(name);
  const assets = resolveFrontendAssets();
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
  <link rel="stylesheet" href="${assets.cssHref}" />
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
  <script type="module" src="${assets.scriptSrc}"></script>
</head>
<body>
  <main class="stack">
    <header class="stack">
      <p><a href="/">Back to the full demo home page</a></p>
      <div class="stack">
        <h1>Progressive enhancement form flow</h1>
        <p>This route is served by the backend runtime. The form still works without client JavaScript, and <code>client-nav</code> upgrades it to a fragment update when available.</p>
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

const rootStatusRoute: DemoRoute = {
  definition: {
    name: 'rootStatusPage',
    method: 'GET',
    path: ROOT_PATH,
    summary: 'Render the default backend status page.',
    interaction: 'navigation',
  },
  handler: () => ({
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
    },
    body: 'API server running',
  }),
};

const progressiveEnhancementPageRoute: DemoRoute = {
  definition: {
    name: 'progressiveEnhancementPage',
    method: 'GET',
    path: DEMO_PATH,
    summary: 'Render the progressive enhancement form demo.',
    interaction: 'navigation',
  },
  handler: (context) => {
    const source = context.query.source === 'redirect' ? 'redirect' : 'baseline';
    const name = readQueryName(context.query);
    const sessionName = readSessionName(context.request);
    const sessionState = readSessionQueryState(context.query);

    return {
      status: 200,
      body: renderDemoPage(name, source, sessionName, sessionState),
    };
  },
};

const progressiveEnhancementSubmitRoute: DemoRoute = {
  definition: {
    name: 'progressiveEnhancementSubmit',
    method: 'POST',
    path: DEMO_PATH,
    summary: 'Handle the progressive enhancement form submission.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
    },
    fragment: {
      target: FRAGMENT_TARGET,
      selector: `#${FRAGMENT_TARGET}`,
      mode: 'replace',
    },
  },
  handler: (context) => {
    const name = readSubmittedName(context.body);
    if (isEnhancedRequest(context.request)) {
      return {
        status: 200,
        fragment: {
          target: FRAGMENT_TARGET,
          selector: `#${FRAGMENT_TARGET}`,
          mode: 'replace',
          body: renderGreeting(name, 'fragment'),
        },
      };
    }

    return {
      status: 303,
      redirect: {
        location: `${DEMO_PATH}?source=redirect&name=${encodeURIComponent(name)}`,
      },
    };
  },
};

const sessionSignInRoute: DemoRoute = {
  definition: {
    name: 'progressiveEnhancementSessionSignIn',
    method: 'POST',
    path: `${DEMO_PATH}/session/sign-in`,
    summary: 'Create a demo session for the progressive enhancement page.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
    },
    fragment: {
      target: SESSION_PANEL_TARGET,
      selector: `#${SESSION_PANEL_TARGET}`,
      mode: 'replace',
    },
  },
  handler: (context) => {
    const sessionName = readSubmittedSessionName(context.body);
    const headers = {
      'set-cookie': createSessionCookie(sessionName),
    };

    if (isEnhancedRequest(context.request)) {
      return {
        status: 200,
        headers,
        fragment: {
          target: SESSION_PANEL_TARGET,
          selector: `#${SESSION_PANEL_TARGET}`,
          mode: 'replace',
          body: renderSessionPanel(sessionName, 'fragment'),
        },
      };
    }

    return {
      status: 303,
      headers,
      redirect: {
        location: `${DEMO_PATH}?session=signed-in`,
      },
    };
  },
};

const sessionSignOutRoute: DemoRoute = {
  definition: {
    name: 'progressiveEnhancementSessionSignOut',
    method: 'POST',
    path: `${DEMO_PATH}/session/sign-out`,
    summary: 'Clear the demo session for the progressive enhancement page.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
    },
    fragment: {
      target: SESSION_PANEL_TARGET,
      selector: `#${SESSION_PANEL_TARGET}`,
      mode: 'replace',
    },
  },
  handler: (context) => {
    const headers = {
      'set-cookie': clearSessionCookie(),
    };

    if (isEnhancedRequest(context.request)) {
      return {
        status: 200,
        headers,
        fragment: {
          target: SESSION_PANEL_TARGET,
          selector: `#${SESSION_PANEL_TARGET}`,
          mode: 'replace',
          body: renderSessionPanel(null, 'fragment'),
        },
      };
    }

    return {
      status: 303,
      headers,
      redirect: {
        location: `${DEMO_PATH}?session=signed-out`,
      },
    };
  },
};

const routes: readonly DemoRoute[] = [
  rootStatusRoute,
  progressiveEnhancementPageRoute,
  progressiveEnhancementSubmitRoute,
  sessionSignInRoute,
  sessionSignOutRoute,
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/full-progressive-enhancement',
    version: '1.0.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition),
  },
  routes,
};

function readSessionName(request: Request): string | null {
  const cookies = new (requireBunCookieMap())(request.headers.get('cookie') ?? '');
  return cookies.get(SESSION_COOKIE_NAME);
}

function createSessionCookie(sessionName: string): string {
  const cookies = new (requireBunCookieMap())();
  cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionName,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 3600,
  });
  const [header] = cookies.toSetCookieHeaders();
  if (!header) {
    throw new Error('Bun.CookieMap did not serialize the progressive-enhancement session cookie.');
  }
  return header;
}

function clearSessionCookie(): string {
  const cookies = new (requireBunCookieMap())();
  cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
    expires: new Date(0),
  });
  const [header] = cookies.toSetCookieHeaders();
  if (!header) {
    throw new Error('Bun.CookieMap did not serialize the progressive-enhancement session clear cookie.');
  }
  return header;
}

function requireBunCookieMap(): BunCookieMapConstructor {
  const runtime = (globalThis as typeof globalThis & { Bun?: BunRuntime }).Bun;
  const CookieMap = runtime?.CookieMap;
  if (!CookieMap) {
    throw new Error('This demo requires Bun.CookieMap.');
  }
  return CookieMap;
}

function resolveFrontendAssets(): { cssHref: string; scriptSrc: string } {
  if (process.env.WEBSTIR_FRONTEND_DEV_SERVER === '1') {
    return DEV_FRONTEND_ASSETS;
  }

  const manifestPath = path.join(resolveWorkspaceRoot(), 'dist', 'frontend', 'manifest.json');
  if (!existsSync(manifestPath)) {
    return DEV_FRONTEND_ASSETS;
  }

  try {
    const raw = readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      shared?: {
        css?: string;
        js?: string;
      };
    };

    const sharedCss = parsed.shared?.css;
    const sharedJs = parsed.shared?.js;
    if (!sharedCss || !sharedJs) {
      return DEV_FRONTEND_ASSETS;
    }

    return {
      cssHref: `/app/${sharedCss}`,
      scriptSrc: `/app/${sharedJs}`,
    };
  } catch {
    return DEV_FRONTEND_ASSETS;
  }
}

function resolveWorkspaceRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}
