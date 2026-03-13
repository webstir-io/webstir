import { assert, test } from '@webstir-io/webstir-testing';

const DEMO_PATH = '/demo/dashboard';

test('dashboard demo page renders the document shell', async () => {
  const page = await requestDemoPage();

  assert.equal(page.response.status, 200);
  assert.isTrue(Boolean(page.cookie));
  assert.isTrue(page.html.includes('<title>Dashboard Proof App</title>'));
  assert.isTrue(page.html.includes('id="dashboard-filter-form"'));
  assert.isTrue(page.html.includes('id="metrics-refresh-form"'));
  assert.isTrue(page.html.includes('id="alerts-panel"'));
  assert.isTrue(page.html.includes('data-webstir-fragment-target="dashboard-shell"'));
  assert.isTrue(
    page.html.includes('type="module" src="/app/')
    || page.html.includes('type="module" src="/pages/home/index.js"')
  );
});

test('native filter submission redirects back and persists the selected dashboard focus', async () => {
  const page = await requestDemoPage();
  const csrf = extractFormInputValue(page.html, 'dashboard-filter-form', '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/context`, page.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: `_csrf=${encodeURIComponent(csrf)}&team=growth&range=month`,
    redirect: 'manual'
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), DEMO_PATH);

  const redirected = await requestDemoPage(page.cookie);
  assert.isTrue(redirected.html.includes('Dashboard focus: Growth · last 30 days'));
  assert.isTrue(redirected.html.includes('Filtered to Growth for last 30 days.'));
  assert.isTrue(redirected.html.includes('<option value="growth" selected>Growth</option>'));
  assert.isTrue(redirected.html.includes('<option value="month" selected>last 30 days</option>'));
});

test('enhanced filter submission returns the dashboard shell fragment', async () => {
  const page = await requestDemoPage();
  const csrf = extractFormInputValue(page.html, 'dashboard-filter-form', '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/context`, page.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(csrf)}&team=north&range=today`
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-webstir-fragment-target'), 'dashboard-shell');
  assert.equal(response.headers.get('x-webstir-fragment-selector'), '#dashboard-shell');
  assert.equal(response.headers.get('x-webstir-fragment-mode'), 'replace');
  assert.isTrue(html.startsWith('<section id="dashboard-shell"'));
  assert.isTrue(html.includes('Dashboard focus: North region · today'));
  assert.isTrue(html.includes('Filtered to North region for today.'));
});

test('enhanced KPI refresh replaces only the metrics panel and persists across reloads', async () => {
  const page = await requestDemoPage();
  const csrf = extractFormInputValue(page.html, 'metrics-refresh-form', '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/metrics/refresh`, page.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(csrf)}`
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-webstir-fragment-target'), 'metrics-panel');
  assert.equal(response.headers.get('x-webstir-fragment-selector'), '#metrics-panel');
  assert.equal(response.headers.get('x-webstir-fragment-mode'), 'replace');
  assert.isTrue(html.startsWith('<section id="metrics-panel"'));
  assert.isTrue(html.includes('Refresh count: 1'));
  assert.isTrue(html.includes('Snapshot refreshed 1 time'));

  const reloaded = await requestDemoPage(page.cookie);
  assert.isTrue(reloaded.html.includes('Refresh count: 1'));
  assert.isTrue(reloaded.html.includes('Snapshot refreshed 1 time'));
});

test('enhanced alert acknowledgement replaces only the alerts panel and persists across reloads', async () => {
  const page = await requestDemoPage();
  const alertId = extractFirstAlertId(page.html);
  const csrf = extractFormInputValue(page.html, `acknowledge-alert-form-${alertId}`, '_csrf');
  const response = await requestWithCookie(`${DEMO_PATH}/alerts/acknowledge`, page.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(csrf)}&alertId=${encodeURIComponent(alertId)}`
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-webstir-fragment-target'), 'alerts-panel');
  assert.equal(response.headers.get('x-webstir-fragment-selector'), '#alerts-panel');
  assert.equal(response.headers.get('x-webstir-fragment-mode'), 'replace');
  assert.isTrue(html.startsWith('<section id="alerts-panel"'));
  assert.equal(html.includes(`data-alert-id="${alertId}"`), false);
  assert.isTrue(html.includes('Acknowledged Build queue latency crossed 18 minutes.'));

  const reloaded = await requestDemoPage(page.cookie);
  assert.equal(reloaded.html.includes(`data-alert-id="${alertId}"`), false);
  assert.isTrue(reloaded.html.includes('Acknowledged Build queue latency crossed 18 minutes.'));
});

interface BackendTestContext {
  request(pathOrUrl?: string | URL, init?: RequestInit): Promise<Response>;
}

function requireBackendTestContext(): BackendTestContext {
  const store = globalThis as Record<string | symbol, unknown>;
  const context = store[Symbol.for('webstir.backendTestContext')] as BackendTestContext | undefined;
  if (!context) {
    throw new Error('Backend test context not available.');
  }
  return context;
}

async function requestDemoPage(cookie?: string): Promise<{
  response: Response;
  html: string;
  cookie: string;
}> {
  const response = await requestWithCookie(DEMO_PATH, cookie);
  const html = await response.text();
  return {
    response,
    html,
    cookie: coalesceCookie(response.headers.get('set-cookie'), cookie)
  };
}

async function requestWithCookie(
  pathOrUrl: string | URL,
  cookie?: string,
  init: RequestInit = {}
): Promise<Response> {
  const ctx = requireBackendTestContext();
  const headers = new Headers(init.headers);
  if (cookie) {
    headers.set('cookie', cookie);
  }
  return await ctx.request(pathOrUrl, {
    ...init,
    headers
  });
}

function extractFormInputValue(html: string, formId: string, name: string): string {
  const formPattern = new RegExp(
    `<form[^>]*id="${escapeRegExp(formId)}"[\\s\\S]*?<input[^>]*name="${escapeRegExp(name)}"[^>]*value="([^"]*)"`,
    'i'
  );
  const match = html.match(formPattern);
  if (!match?.[1]) {
    throw new Error(`Expected input ${name} in form ${formId}.`);
  }
  return decodeHtml(match[1]);
}

function extractFirstAlertId(html: string): string {
  const match = html.match(/data-alert-id="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error('Expected at least one alert row.');
  }
  return decodeHtml(match[1]);
}

function coalesceCookie(setCookie: string | null, existing: string | undefined): string {
  const cookie = setCookie?.split(';', 1)[0] ?? existing;
  if (!cookie) {
    throw new Error('Expected a session cookie.');
  }
  return cookie;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
