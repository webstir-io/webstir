import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

type IncomingRequest = http.IncomingMessage;
type ServerResponse = http.ServerResponse<IncomingRequest>;

const DEMO_PATH = '/demo/dashboard';
const SHELL_TARGET = 'dashboard-shell';
const METRICS_TARGET = 'metrics-panel';
const ALERTS_TARGET = 'alerts-panel';
const SESSION_COOKIE_NAME = 'webstir_demo_dashboard';
const FILTER_ACTION = './dashboard/context';
const METRICS_REFRESH_ACTION = './dashboard/metrics/refresh';
const ACKNOWLEDGE_ALERT_ACTION = './dashboard/alerts/acknowledge';
const SESSION_MAX_AGE_SECONDS = 60 * 60;
const DEV_FRONTEND_ASSETS = {
  cssHref: '/app/app.css',
  scriptSrc: '/pages/home/index.js'
} as const;

type DashboardRange = 'today' | 'week' | 'month';
type DashboardTeam = 'north' | 'platform' | 'growth';
type FlashLevel = 'info' | 'success' | 'warning' | 'error';

interface RouteMatch {
  readonly name: string;
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly summary: string;
  readonly interaction?: 'navigation' | 'mutation';
  readonly form?: {
    readonly contentType: 'application/x-www-form-urlencoded';
    readonly csrf?: boolean;
  };
  readonly fragment?: {
    readonly target: string;
    readonly selector?: string;
    readonly mode?: 'replace';
  };
}

interface RouteContext {
  readonly request: IncomingRequest;
  readonly reply: ServerResponse;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

interface RouteResult {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly redirect?: {
    readonly location: string;
  };
  readonly fragment?: {
    readonly target: string;
    readonly selector?: string;
    readonly mode?: 'replace';
    readonly body: unknown;
  };
}

interface DemoRoute {
  readonly definition?: RouteMatch;
  readonly handler?: (context: RouteContext) => Promise<RouteResult> | RouteResult;
}

interface FlashMessage {
  readonly key: string;
  readonly level: FlashLevel;
  readonly text: string;
}

interface DashboardAlert {
  readonly id: string;
  readonly team: DashboardTeam;
  readonly service: string;
  readonly title: string;
  readonly severity: 'high' | 'medium' | 'low';
  readonly ageMinutes: number;
}

interface ActivityItem {
  readonly id: string;
  readonly text: string;
  readonly category: 'filters' | 'metrics' | 'alerts';
  readonly timestamp: string;
}

interface DemoSession {
  readonly id: string;
  selectedRange: DashboardRange;
  selectedTeam: DashboardTeam;
  refreshCount: number;
  alerts: DashboardAlert[];
  activity: ActivityItem[];
  flash: FlashMessage[];
  panelStatus: {
    metrics: string;
    alerts: string;
  };
  csrf: Record<string, string>;
}

interface PageState {
  readonly flash: readonly FlashMessage[];
  readonly panelStatus: {
    readonly metrics: string;
    readonly alerts: string;
  };
}

interface SessionAccess {
  readonly session: DemoSession;
  readonly setCookie?: string;
}

const FORM_IDS = {
  filters: 'dashboard-filters',
  refreshMetrics: 'refresh-metrics',
  acknowledgeAlert: (alertId: string) => `ack-alert:${alertId}`
} as const;

const METRIC_BASELINES: Record<DashboardTeam, Record<DashboardRange, {
  visitors: number;
  conversionRate: number;
  queueMinutes: number;
  launches: number;
}>> = {
  north: {
    today: { visitors: 1240, conversionRate: 4.8, queueMinutes: 18, launches: 2 },
    week: { visitors: 8820, conversionRate: 5.3, queueMinutes: 16, launches: 8 },
    month: { visitors: 38100, conversionRate: 5.6, queueMinutes: 14, launches: 21 }
  },
  platform: {
    today: { visitors: 980, conversionRate: 3.6, queueMinutes: 24, launches: 1 },
    week: { visitors: 6410, conversionRate: 4.1, queueMinutes: 19, launches: 6 },
    month: { visitors: 28900, conversionRate: 4.4, queueMinutes: 17, launches: 18 }
  },
  growth: {
    today: { visitors: 1730, conversionRate: 6.1, queueMinutes: 12, launches: 4 },
    week: { visitors: 11980, conversionRate: 6.4, queueMinutes: 11, launches: 14 },
    month: { visitors: 49600, conversionRate: 6.8, queueMinutes: 9, launches: 33 }
  }
};

const sessionStore = new Map<string, DemoSession>();

const pageRoute: DemoRoute = {
  definition: {
    name: 'dashboardPage',
    method: 'GET',
    path: DEMO_PATH,
    summary: 'Render the dashboard proof application.',
    interaction: 'navigation'
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const pageState = consumePageState(access.session);
    return {
      status: 200,
      headers: withSessionCookie(access.setCookie),
      body: renderDashboardPage(access.session, pageState)
    };
  }
};

const updateFiltersRoute: DemoRoute = {
  definition: {
    name: 'dashboardUpdateFilters',
    method: 'POST',
    path: `${DEMO_PATH}/context`,
    summary: 'Persist the selected dashboard filters.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true
    },
    fragment: {
      target: SHELL_TARGET,
      selector: `#${SHELL_TARGET}`,
      mode: 'replace'
    }
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const values = normalizeFormValues(context.body);

    if (!hasValidCsrf(access.session, FORM_IDS.filters, values)) {
      pushFlash(access.session, {
        key: 'filters-expired',
        level: 'error',
        text: 'Dashboard filters expired. Reload the page and try again.'
      });
      return respondWithShell(context.request, access, 403);
    }

    const range = values.range?.trim();
    const team = values.team?.trim();
    if (!isDashboardRange(range) || !isDashboardTeam(team)) {
      pushFlash(access.session, {
        key: 'filters-invalid',
        level: 'error',
        text: 'Choose a supported range and team.'
      });
      return respondWithShell(context.request, access, 422);
    }

    access.session.selectedRange = range;
    access.session.selectedTeam = team;
    prependActivity(access.session, {
      category: 'filters',
      text: `Focused the dashboard on ${formatTeam(team)} for ${formatRange(range)}.`
    });
    pushFlash(access.session, {
      key: 'filters-updated',
      level: 'success',
      text: `Filtered to ${formatTeam(team)} for ${formatRange(range)}.`
    });

    return respondWithShell(context.request, access, 200);
  }
};

const refreshMetricsRoute: DemoRoute = {
  definition: {
    name: 'dashboardRefreshMetrics',
    method: 'POST',
    path: `${DEMO_PATH}/metrics/refresh`,
    summary: 'Refresh the metrics snapshot in the dashboard proof application.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true
    },
    fragment: {
      target: METRICS_TARGET,
      selector: `#${METRICS_TARGET}`,
      mode: 'replace'
    }
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const values = normalizeFormValues(context.body);

    if (!hasValidCsrf(access.session, FORM_IDS.refreshMetrics, values)) {
      access.session.panelStatus.metrics = 'Refresh token expired. Reload the page and try again.';
      return respondWithMetricsPanel(context.request, access, 403);
    }

    access.session.refreshCount += 1;
    access.session.panelStatus.metrics = `Snapshot refreshed ${access.session.refreshCount} time${access.session.refreshCount === 1 ? '' : 's'} for ${formatTeam(access.session.selectedTeam)}.`;
    prependActivity(access.session, {
      category: 'metrics',
      text: `Refreshed KPI snapshot for ${formatTeam(access.session.selectedTeam)}.`
    });

    return respondWithMetricsPanel(context.request, access, 200);
  }
};

const acknowledgeAlertRoute: DemoRoute = {
  definition: {
    name: 'dashboardAcknowledgeAlert',
    method: 'POST',
    path: `${DEMO_PATH}/alerts/acknowledge`,
    summary: 'Acknowledge one alert in the dashboard proof application.',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      csrf: true
    },
    fragment: {
      target: ALERTS_TARGET,
      selector: `#${ALERTS_TARGET}`,
      mode: 'replace'
    }
  },
  handler: (context) => {
    const access = resolveSession(context.request);
    const values = normalizeFormValues(context.body);
    const alertId = values.alertId?.trim() ?? '';

    if (!hasValidCsrf(access.session, FORM_IDS.acknowledgeAlert(alertId || 'missing'), values)) {
      access.session.panelStatus.alerts = 'Alert action expired. Reload the page and try again.';
      return respondWithAlertsPanel(context.request, access, 403);
    }

    const alertIndex = access.session.alerts.findIndex((candidate) => candidate.id === alertId);
    if (alertIndex < 0) {
      access.session.panelStatus.alerts = 'That alert is already cleared.';
      return respondWithAlertsPanel(context.request, access, 404);
    }

    const [alert] = access.session.alerts.splice(alertIndex, 1);
    access.session.panelStatus.alerts = `Acknowledged ${alert?.title ?? 'the selected alert'}.`;
    prependActivity(access.session, {
      category: 'alerts',
      text: `Acknowledged ${alert?.title ?? 'an alert'} on ${alert?.service ?? 'unknown service'}.`
    });

    return respondWithAlertsPanel(context.request, access, 200);
  }
};

const routes: readonly DemoRoute[] = [
  pageRoute,
  updateFiltersRoute,
  refreshMetricsRoute,
  acknowledgeAlertRoute
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/dashboard',
    version: '1.0.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};

const PORT = Number(process.env.PORT || 4321);

const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running at http://localhost:${PORT}`);
});

async function handleRequest(request: IncomingRequest, response: ServerResponse): Promise<void> {
  if (!request.url) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'bad_request' }));
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('API server running');
    return;
  }

  const route = findRoute(url.pathname, request.method ?? 'GET');
  if (!route?.handler) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const body = await readBody(request);
  const result = await route.handler({
    request,
    reply: response,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  sendRouteResponse(response, result);
}

function findRoute(pathname: string, method: string): DemoRoute | undefined {
  const normalizedMethod = method.toUpperCase();
  return routes.find((route) =>
    route.definition?.path === pathname && route.definition?.method === normalizedMethod
  );
}

async function readBody(request: IncomingRequest): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) {
    return undefined;
  }

  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

function respondWithShell(request: IncomingRequest, access: SessionAccess, status: number): RouteResult {
  if (isEnhancedRequest(request)) {
    return {
      status,
      headers: withSessionCookie(access.setCookie),
      fragment: {
        target: SHELL_TARGET,
        selector: `#${SHELL_TARGET}`,
        mode: 'replace',
        body: renderDashboardShell(access.session, peekPageState(access.session))
      }
    };
  }

  return {
    status: 303,
    headers: withSessionCookie(access.setCookie),
    redirect: {
      location: DEMO_PATH
    }
  };
}

function respondWithMetricsPanel(request: IncomingRequest, access: SessionAccess, status: number): RouteResult {
  if (isEnhancedRequest(request)) {
    return {
      status,
      headers: withSessionCookie(access.setCookie),
      fragment: {
        target: METRICS_TARGET,
        selector: `#${METRICS_TARGET}`,
        mode: 'replace',
        body: renderMetricsPanel(access.session, peekPageState(access.session))
      }
    };
  }

  return {
    status: 303,
    headers: withSessionCookie(access.setCookie),
    redirect: {
      location: DEMO_PATH
    }
  };
}

function respondWithAlertsPanel(request: IncomingRequest, access: SessionAccess, status: number): RouteResult {
  if (isEnhancedRequest(request)) {
    return {
      status,
      headers: withSessionCookie(access.setCookie),
      fragment: {
        target: ALERTS_TARGET,
        selector: `#${ALERTS_TARGET}`,
        mode: 'replace',
        body: renderAlertsPanel(access.session, peekPageState(access.session))
      }
    };
  }

  return {
    status: 303,
    headers: withSessionCookie(access.setCookie),
    redirect: {
      location: DEMO_PATH
    }
  };
}

function withSessionCookie(setCookie: string | undefined): Record<string, string> | undefined {
  return setCookie ? { 'set-cookie': setCookie } : undefined;
}

function resolveSession(request: IncomingRequest): SessionAccess {
  const cookies = parseCookies(request.headers.cookie);
  const existingId = cookies[SESSION_COOKIE_NAME];
  const existing = existingId ? sessionStore.get(existingId) : undefined;
  if (existing) {
    return { session: existing };
  }

  const session = createSession();
  sessionStore.set(session.id, session);
  return {
    session,
    setCookie: createSessionCookie(session.id)
  };
}

function createSession(): DemoSession {
  return {
    id: randomUUID(),
    selectedRange: 'week',
    selectedTeam: 'platform',
    refreshCount: 0,
    alerts: createSeedAlerts(),
    activity: createSeedActivity(),
    flash: [],
    panelStatus: {
      metrics: 'Refresh this panel to prove targeted fragment swaps without a SPA router.',
      alerts: 'Acknowledge one alert to replace only the alert stack.'
    },
    csrf: {}
  };
}

function createSessionCookie(sessionId: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`
  ].join('; ');
}

function createSeedAlerts(): DashboardAlert[] {
  return [
    {
      id: 'alert-platform-sync',
      team: 'platform',
      service: 'Release sync',
      title: 'Build queue latency crossed 18 minutes.',
      severity: 'high',
      ageMinutes: 12
    },
    {
      id: 'alert-growth-drop',
      team: 'growth',
      service: 'Signup funnel',
      title: 'Paid conversion dipped below target this hour.',
      severity: 'medium',
      ageMinutes: 24
    },
    {
      id: 'alert-north-cache',
      team: 'north',
      service: 'Edge cache',
      title: 'Regional cache invalidation lag detected.',
      severity: 'low',
      ageMinutes: 31
    }
  ];
}

function createSeedActivity(): ActivityItem[] {
  const now = new Date();
  return [
    {
      id: 'activity-1',
      category: 'metrics',
      text: 'Published the request-time dashboard shell for the morning stand-up.',
      timestamp: new Date(now.getTime() - 12 * 60_000).toISOString()
    },
    {
      id: 'activity-2',
      category: 'alerts',
      text: 'Queued alert review for build latency and conversion drift.',
      timestamp: new Date(now.getTime() - 28 * 60_000).toISOString()
    },
    {
      id: 'activity-3',
      category: 'filters',
      text: 'Pinned the platform team as the default dashboard focus.',
      timestamp: new Date(now.getTime() - 53 * 60_000).toISOString()
    }
  ];
}

function parseCookies(header: string | string[] | undefined): Record<string, string> {
  const joined = Array.isArray(header) ? header.join(';') : (header ?? '');
  const values: Record<string, string> = {};
  for (const part of joined.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) {
      continue;
    }

    try {
      values[key] = decodeURIComponent(value);
    } catch {
      values[key] = value;
    }
  }

  return values;
}

function normalizeFormValues(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    values[key] = typeof value === 'string' ? value : String(value ?? '');
  }
  return values;
}

function hasValidCsrf(
  session: DemoSession,
  formId: string,
  values: Record<string, string>
): boolean {
  const providedToken = values._csrf?.trim() ?? '';
  return providedToken !== '' && providedToken === ensureCsrfToken(session, formId);
}

function ensureCsrfToken(session: DemoSession, formId: string): string {
  session.csrf[formId] ??= randomUUID();
  return session.csrf[formId];
}

function pushFlash(session: DemoSession, message: FlashMessage): void {
  session.flash.push({ ...message });
}

function prependActivity(
  session: DemoSession,
  item: Pick<ActivityItem, 'category' | 'text'>
): void {
  session.activity.unshift({
    id: randomUUID().replaceAll('-', '').slice(0, 10),
    category: item.category,
    text: item.text,
    timestamp: new Date().toISOString()
  });
  session.activity = session.activity.slice(0, 6);
}

function peekPageState(session: DemoSession): PageState {
  return {
    flash: session.flash.map((message) => ({ ...message })),
    panelStatus: {
      metrics: session.panelStatus.metrics,
      alerts: session.panelStatus.alerts
    }
  };
}

function consumePageState(session: DemoSession): PageState {
  const state = peekPageState(session);
  session.flash = [];
  return state;
}

function isEnhancedRequest(request: IncomingRequest): boolean {
  const header = request.headers['x-webstir-client-nav'];
  return header === '1' || (Array.isArray(header) && header.includes('1'));
}

function renderDashboardPage(session: DemoSession, pageState: PageState): string {
  const assets = resolveFrontendAssets();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Dashboard Proof App</title>
  <link rel="stylesheet" href="${assets.cssHref}" />
  <style>
    body { background: linear-gradient(180deg, #f7f4ed 0%, #efe7d8 100%); color: #182026; }
    main { max-width: 76rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
    .stack { display: grid; gap: 1.25rem; }
    .dashboard-grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
    .card { background: rgba(255, 252, 246, 0.94); border: 1px solid #dccfb6; border-radius: 1rem; padding: 1.25rem; box-shadow: 0 1rem 2rem rgba(24, 32, 38, 0.08); }
    .hero { background: linear-gradient(135deg, #143044 0%, #28506f 100%); color: #f7f4ed; border-color: #143044; }
    .hero a { color: #f7f4ed; }
    .hero p { color: rgba(247, 244, 237, 0.84); }
    .eyebrow { margin: 0; text-transform: uppercase; letter-spacing: 0.16em; font-size: 0.78rem; font-weight: 700; }
    .status { margin: 0; color: #5d6459; }
    .hero .status { color: rgba(247, 244, 237, 0.72); }
    .panel-title { display: flex; justify-content: space-between; gap: 1rem; align-items: start; flex-wrap: wrap; }
    .chip { width: fit-content; border-radius: 999px; border: 1px solid #c6b893; background: #f0e4c5; color: #6a4b00; padding: 0.38rem 0.72rem; font-size: 0.85rem; }
    .filters { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }
    .metric-grid { display: grid; gap: 0.85rem; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); }
    .metric { border: 1px solid #e5dbc8; border-radius: 0.9rem; padding: 0.95rem; background: #fffaf1; }
    .metric-label { margin: 0 0 0.35rem; font-size: 0.86rem; color: #675f52; text-transform: uppercase; letter-spacing: 0.08em; }
    .metric-value { margin: 0; font-size: clamp(1.8rem, 4vw, 2.5rem); font-weight: 700; color: #173c54; }
    .alert-list, .activity-list, .flash-list { display: grid; gap: 0.8rem; margin: 0; padding: 0; list-style: none; }
    .alert { border: 1px solid #e5dbc8; border-radius: 0.9rem; padding: 0.95rem; background: #fffaf1; }
    .alert[data-severity="high"] { border-color: #dbb0a6; background: #fff0ee; }
    .alert[data-severity="medium"] { border-color: #e0c37f; background: #fff8e6; }
    .alert[data-severity="low"] { border-color: #bfd0db; background: #eff7fb; }
    .alert-meta, .activity-meta { display: flex; gap: 0.75rem; flex-wrap: wrap; color: #675f52; font-size: 0.92rem; }
    .flash { margin: 0; padding: 0.85rem 1rem; border-radius: 0.8rem; border: 1px solid transparent; }
    .flash[data-level="success"] { background: #eaf7ec; color: #195a34; border-color: #b8d7bf; }
    .flash[data-level="info"] { background: #eef5fb; color: #194d7a; border-color: #bed0e2; }
    .flash[data-level="warning"] { background: #fff7e0; color: #7a5b00; border-color: #e5cc80; }
    .flash[data-level="error"] { background: #fdeeee; color: #8a2222; border-color: #e2b9b9; }
    .subtle { color: #675f52; }
    label { display: grid; gap: 0.45rem; font-weight: 600; }
    input, select, button { font: inherit; }
    input, select { width: 100%; box-sizing: border-box; padding: 0.78rem 0.9rem; border-radius: 0.75rem; border: 1px solid #c9bba1; background: #ffffff; }
    button { width: fit-content; padding: 0.78rem 1rem; border-radius: 999px; border: 0; background: #173c54; color: #ffffff; cursor: pointer; }
    button.secondary { background: #7b4426; }
    .button-row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  </style>
  <script type="module" src="${assets.scriptSrc}"></script>
</head>
<body>
  <main class="stack">
    <header class="card hero stack">
      <p><a href="/">Back to the dashboard demo home page</a></p>
      <p class="eyebrow">Webstir dashboard proof app</p>
      <div class="stack">
        <h1>HTML-first dashboard proof app</h1>
        <p>This backend-served dashboard uses server-handled forms for filter changes, KPI refreshes, and alert acknowledgements. With JavaScript enabled, Webstir swaps fragments; without it, the same forms redirect back to the document.</p>
        <p class="status">Use this alongside auth + CRUD as the canonical proof that partial refreshes do not require SPA architecture.</p>
      </div>
    </header>
    ${renderDashboardShell(session, pageState)}
  </main>
</body>
</html>`;
}

function renderDashboardShell(session: DemoSession, pageState: PageState): string {
  return [
    `<section id="${SHELL_TARGET}" data-webstir-fragment-target="${SHELL_TARGET}" class="stack" aria-live="polite">`,
    renderFlashRegion(pageState.flash),
    renderFiltersPanel(session),
    '<div class="dashboard-grid">',
    renderMetricsPanel(session, pageState),
    renderAlertsPanel(session, pageState),
    '</div>',
    renderActivityPanel(session),
    '</section>'
  ].join('\n');
}

function renderFlashRegion(messages: readonly FlashMessage[]): string {
  if (messages.length === 0) {
    return [
      '<section id="flash-region" class="card stack">',
      '  <h2>Interaction loop</h2>',
      '  <p class="status">Submit the filter form, refresh KPIs, or acknowledge an alert to compare fragment swaps with redirect-after-post fallbacks.</p>',
      '</section>'
    ].join('\n');
  }

  return [
    '<section id="flash-region" class="card stack">',
    '  <h2>Interaction loop</h2>',
    '  <div class="flash-list">',
    ...messages.map((message) =>
      `    <p class="flash" data-level="${message.level}" data-flash-key="${escapeHtml(message.key)}">${escapeHtml(message.text)}</p>`
    ),
    '  </div>',
    '</section>'
  ].join('\n');
}

function renderFiltersPanel(session: DemoSession): string {
  return [
    '<section id="filters-panel" class="card stack">',
    '  <div class="panel-title">',
    '    <div class="stack">',
    '      <h2 id="dashboard-heading">Dashboard focus: ' + escapeHtml(formatTeam(session.selectedTeam)) + ' · ' + escapeHtml(formatRange(session.selectedRange)) + '</h2>',
    '      <p class="status">The filter form replaces the whole dashboard shell when enhanced so metrics, alerts, and activity stay in sync.</p>',
    '    </div>',
    '    <span class="chip">Shell fragment target</span>',
    '  </div>',
    `  <form id="dashboard-filter-form" method="post" action="${FILTER_ACTION}" class="stack">`,
    `    <input type="hidden" name="_csrf" value="${escapeHtml(ensureCsrfToken(session, FORM_IDS.filters))}" />`,
    '    <div class="filters">',
    '      <label for="dashboard-team">',
    '        Team',
    renderTeamSelect(session.selectedTeam),
    '      </label>',
    '      <label for="dashboard-range">',
    '        Range',
    renderRangeSelect(session.selectedRange),
    '      </label>',
    '    </div>',
    '    <div class="button-row">',
    '      <button id="dashboard-apply-filters" type="submit">Apply filters</button>',
    '    </div>',
    '  </form>',
    '</section>'
  ].join('\n');
}

function renderMetricsPanel(session: DemoSession, pageState: PageState): string {
  const metrics = computeMetrics(session.selectedTeam, session.selectedRange, session.refreshCount);

  return [
    `<section id="${METRICS_TARGET}" data-webstir-fragment-target="${METRICS_TARGET}" class="card stack">`,
    '  <div class="panel-title">',
    '    <div class="stack">',
    '      <h2>KPI snapshot</h2>',
    `      <p id="metrics-status" class="status">${escapeHtml(pageState.panelStatus.metrics)}</p>`,
    '    </div>',
    `    <span class="chip" id="metrics-refresh-count">Refresh count: ${session.refreshCount}</span>`,
    '  </div>',
    '  <div class="metric-grid">',
    renderMetricCard('Qualified sessions', formatCompactNumber(metrics.visitors)),
    renderMetricCard('Conversion rate', `${metrics.conversionRate.toFixed(1)}%`),
    renderMetricCard('Queue age', `${metrics.queueMinutes} min`),
    renderMetricCard('Launches shipped', String(metrics.launches)),
    '  </div>',
    `  <form id="metrics-refresh-form" method="post" action="${METRICS_REFRESH_ACTION}" class="button-row">`,
    `    <input type="hidden" name="_csrf" value="${escapeHtml(ensureCsrfToken(session, FORM_IDS.refreshMetrics))}" />`,
    '    <button id="metrics-refresh" type="submit">Refresh KPI panel</button>',
    '  </form>',
    '</section>'
  ].join('\n');
}

function renderMetricCard(label: string, value: string): string {
  return [
    '    <article class="metric">',
    `      <p class="metric-label">${escapeHtml(label)}</p>`,
    `      <p class="metric-value">${escapeHtml(value)}</p>`,
    '    </article>'
  ].join('\n');
}

function renderAlertsPanel(session: DemoSession, pageState: PageState): string {
  const alerts = session.alerts.filter((alert) => alert.team === session.selectedTeam);

  return [
    `<section id="${ALERTS_TARGET}" data-webstir-fragment-target="${ALERTS_TARGET}" class="card stack">`,
    '  <div class="panel-title">',
    '    <div class="stack">',
    '      <h2>Live alerts</h2>',
    `      <p id="alerts-status" class="status">${escapeHtml(pageState.panelStatus.alerts)}</p>`,
    '    </div>',
    `    <span class="chip">${alerts.length} active</span>`,
    '  </div>',
    alerts.length === 0
      ? '  <p id="alerts-empty" class="status">No active alerts remain for this team. Switch filters to inspect another region.</p>'
      : [
          '  <ul class="alert-list">',
          ...alerts.map((alert) => renderAlertItem(session, alert)),
          '  </ul>'
        ].join('\n'),
    '</section>'
  ].join('\n');
}

function renderAlertItem(session: DemoSession, alert: DashboardAlert): string {
  return [
    `    <li class="alert stack" data-alert-row="true" data-alert-id="${escapeHtml(alert.id)}" data-severity="${alert.severity}">`,
    `      <div class="panel-title"><strong>${escapeHtml(alert.title)}</strong><span class="chip">${escapeHtml(alert.severity)}</span></div>`,
    `      <p class="subtle">${escapeHtml(alert.service)}</p>`,
    `      <p class="alert-meta"><span>${alert.ageMinutes} min old</span><span>${escapeHtml(formatTeam(alert.team))}</span></p>`,
    `      <form id="acknowledge-alert-form-${escapeHtml(alert.id)}" method="post" action="${ACKNOWLEDGE_ALERT_ACTION}" class="button-row">`,
    `        <input type="hidden" name="_csrf" value="${escapeHtml(ensureCsrfToken(session, FORM_IDS.acknowledgeAlert(alert.id)))}" />`,
    `        <input type="hidden" name="alertId" value="${escapeHtml(alert.id)}" />`,
    `        <button id="acknowledge-alert-${escapeHtml(alert.id)}" class="secondary" type="submit">Acknowledge alert</button>`,
    '      </form>',
    '    </li>'
  ].join('\n');
}

function renderActivityPanel(session: DemoSession): string {
  return [
    '<section id="activity-panel" class="card stack">',
    '  <div class="panel-title">',
    '    <div class="stack">',
    '      <h2>Recent activity</h2>',
    '      <p class="status">Each successful mutation appends to this server-side timeline so reloads confirm the same backend state.</p>',
    '    </div>',
    '    <span class="chip">Persisted in session</span>',
    '  </div>',
    '  <ol id="activity-feed" class="activity-list">',
    ...session.activity.map((item) => [
      `    <li data-activity-id="${escapeHtml(item.id)}" data-activity-category="${escapeHtml(item.category)}" class="stack">`,
      `      <strong>${escapeHtml(item.text)}</strong>`,
      `      <p class="activity-meta"><span>${escapeHtml(capitalize(item.category))}</span><span>${escapeHtml(formatIsoDate(item.timestamp))}</span></p>`,
      '    </li>'
    ].join('\n')),
    '  </ol>',
    '</section>'
  ].join('\n');
}

function renderTeamSelect(selected: DashboardTeam): string {
  return [
    '        <select id="dashboard-team" name="team">',
    ...(['north', 'platform', 'growth'] as const).map((team) =>
      `          <option value="${team}"${selected === team ? ' selected' : ''}>${escapeHtml(formatTeam(team))}</option>`
    ),
    '        </select>'
  ].join('\n');
}

function renderRangeSelect(selected: DashboardRange): string {
  return [
    '        <select id="dashboard-range" name="range">',
    ...(['today', 'week', 'month'] as const).map((range) =>
      `          <option value="${range}"${selected === range ? ' selected' : ''}>${escapeHtml(formatRange(range))}</option>`
    ),
    '        </select>'
  ].join('\n');
}

function computeMetrics(team: DashboardTeam, range: DashboardRange, refreshCount: number): {
  visitors: number;
  conversionRate: number;
  queueMinutes: number;
  launches: number;
} {
  const baseline = METRIC_BASELINES[team][range];
  return {
    visitors: baseline.visitors + refreshCount * 73,
    conversionRate: baseline.conversionRate + refreshCount * 0.2,
    queueMinutes: Math.max(4, baseline.queueMinutes - Math.min(refreshCount, 5)),
    launches: baseline.launches + refreshCount
  };
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 10_000 ? 1 : 0
  }).format(value);
}

function isDashboardTeam(value: string | undefined): value is DashboardTeam {
  return value === 'north' || value === 'platform' || value === 'growth';
}

function isDashboardRange(value: string | undefined): value is DashboardRange {
  return value === 'today' || value === 'week' || value === 'month';
}

function formatTeam(value: DashboardTeam): string {
  if (value === 'north') {
    return 'North region';
  }
  if (value === 'platform') {
    return 'Platform';
  }
  return 'Growth';
}

function formatRange(value: DashboardRange): string {
  if (value === 'today') {
    return 'today';
  }
  if (value === 'week') {
    return 'last 7 days';
  }
  return 'last 30 days';
}

function formatIsoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sendRouteResponse(response: ServerResponse, result: RouteResult): void {
  const status = result.redirect ? (result.status ?? 303) : (result.status ?? 200);
  const headers: Record<string, string> = { ...(result.headers ?? {}) };

  if (result.redirect) {
    headers.location = result.redirect.location;
  }

  if (result.fragment) {
    headers['x-webstir-fragment-target'] = result.fragment.target;
    if (result.fragment.selector) {
      headers['x-webstir-fragment-selector'] = result.fragment.selector;
    }
    if (result.fragment.mode) {
      headers['x-webstir-fragment-mode'] = result.fragment.mode;
    }
  }

  const payload = result.fragment?.body ?? result.body;
  if (payload !== undefined && payload !== null && !hasHeader(headers, 'content-type')) {
    headers['content-type'] = typeof payload === 'string'
      ? 'text/html; charset=utf-8'
      : 'application/json';
  }

  response.writeHead(status, headers);

  if (result.redirect || payload === undefined || payload === null) {
    response.end('');
    return;
  }

  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    response.end(payload);
    return;
  }

  response.end(JSON.stringify(payload));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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

export default server;
