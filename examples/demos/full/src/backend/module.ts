import type http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEMO_PATH = '/demo/progressive-enhancement';
const FRAGMENT_TARGET = 'greeting-preview';
const DEV_FRONTEND_ASSETS = {
  cssHref: '/app/app.css',
  scriptSrc: '/app/app.js'
} as const;

interface RouteContext {
  readonly request: http.IncomingMessage;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

interface RouteResult {
  readonly status?: number;
  readonly body?: string;
  readonly redirect?: {
    readonly location: string;
  };
  readonly fragment?: {
    readonly target: string;
    readonly selector?: string;
    readonly mode?: 'replace' | 'append' | 'prepend';
    readonly body: string;
  };
}

interface RouteDefinition {
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

interface Route {
  readonly definition: RouteDefinition;
  readonly handler: (context: RouteContext) => Promise<RouteResult> | RouteResult;
}

function readSubmittedName(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return 'Webstir';
  }

  const rawValue = (body as Record<string, unknown>).name;
  const normalized = typeof rawValue === 'string' ? rawValue.trim() : '';
  return normalized || 'Webstir';
}

function readQueryName(query: Record<string, string>): string {
  const normalized = String(query.name ?? '').trim();
  return normalized || 'Webstir';
}

function isEnhancedRequest(request: http.IncomingMessage): boolean {
  const header = request.headers['x-webstir-client-nav'];
  return header === '1' || (Array.isArray(header) && header.includes('1'));
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

  return [
    `<section id="${FRAGMENT_TARGET}" data-webstir-fragment-target="${FRAGMENT_TARGET}" aria-live="polite">`,
    `  <h2>Hello, ${escapedName}</h2>`,
    `  <p>${message}</p>`,
    '</section>'
  ].join('\n');
}

function renderDemoPage(name: string, source: 'baseline' | 'redirect'): string {
  const escapedName = escapeHtml(name);
  const assets = resolveFrontendAssets();
  const status =
    source === 'redirect'
      ? '<p class="status">Last submit used the no-JavaScript redirect path.</p>'
      : '<p class="status">This page is ready for progressive enhancement via <code>client-nav</code>.</p>';

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
    <section class="card stack">
      <form method="post">
        <label for="demo-name">Name</label>
        <input id="demo-name" name="name" value="${escapedName}" autocomplete="name" autofocus />
        <button type="submit">Update greeting</button>
      </form>
      ${renderGreeting(name, source)}
    </section>
  </main>
</body>
</html>`;
}

const progressiveEnhancementPageRoute: Route = {
  definition: {
    name: 'progressiveEnhancementPage',
    method: 'GET',
    path: DEMO_PATH,
    summary: 'Render the progressive enhancement form demo.',
    interaction: 'navigation'
  },
  handler: (context) => {
    const source = context.query.source === 'redirect' ? 'redirect' : 'baseline';
    const name = readQueryName(context.query);

    return {
      status: 200,
      body: renderDemoPage(name, source)
    };
  }
};

const progressiveEnhancementSubmitRoute: Route = {
  definition: {
    name: 'progressiveEnhancementSubmit',
    method: 'POST',
    path: DEMO_PATH,
    summary: 'Handle the progressive enhancement form submission.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded'
    },
    fragment: {
      target: FRAGMENT_TARGET,
      selector: `#${FRAGMENT_TARGET}`,
      mode: 'replace'
    }
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
          body: renderGreeting(name, 'fragment')
        }
      };
    }

    return {
      status: 303,
      redirect: {
        location: `${DEMO_PATH}?source=redirect&name=${encodeURIComponent(name)}`
      }
    };
  }
};

const routes = [progressiveEnhancementPageRoute, progressiveEnhancementSubmitRoute];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/full-progressive-enhancement',
    version: '1.0.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};

function resolveFrontendAssets(): { cssHref: string; scriptSrc: string } {
  const manifestPath = path.join(process.cwd(), 'dist', 'frontend', 'manifest.json');
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
      scriptSrc: `/app/${sharedJs}`
    };
  } catch {
    return DEV_FRONTEND_ASSETS;
  }
}
