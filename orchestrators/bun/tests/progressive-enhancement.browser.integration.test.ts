import { runWebstir } from '../test-support/cli.ts';
import { assertPreparedPage } from '../test-support/prepared-page-browser.ts';
import { assertPageLifecycle } from '../test-support/page-lifecycle-browser.ts';
import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';

test('browser progressive enhancement flows work in watch mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-progressive-watch-', 'full');

  try {
    await runWatchBrowserScenarioWithRetry(
      workspace,
      (origin, progress) => exerciseBrowserScenario(origin, progress),
      {
        scenarioTimeoutMs: 60_000,
      },
    );
  } finally {
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

test('browser progressive enhancement flows work in publish mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-progressive-publish-', 'full');

  try {
    await runPublishBrowserScenarioWithRetry(workspace, (origin, progress) =>
      exerciseBrowserScenario(origin, progress),
    );
  } finally {
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

test('browser auth and CRUD flows work in watch mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-auth-crud-watch-', 'auth-crud');

  try {
    await runWatchBrowserScenarioWithRetry(workspace, exerciseAuthCrudBrowserScenario, {
      readinessChecks: [
        {
          requestPath: '/api/demo/auth-crud',
          expectedText: 'id="auth-sign-in-form"',
        },
      ],
      scenarioTimeoutMs: 45_000,
    });
  } finally {
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 150_000);

test('browser auth and CRUD flows work in publish mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-auth-crud-publish-', 'auth-crud');
  let session: RuntimeSession | undefined;

  try {
    session = await startPublishSession(workspace, {
      readinessChecks: [
        {
          requestPath: '/api/demo/auth-crud',
          expectedText: 'id="auth-sign-in-form"',
        },
      ],
    });
    await exerciseAuthCrudPublishScenario(session.origin);
  } catch (error) {
    throw appendLogs(error, session?.getLogs() ?? {});
  } finally {
    if (session) {
      await session.stop();
    }
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

test('browser dashboard flows work in watch mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-dashboard-watch-', 'dashboard');

  try {
    await runWatchBrowserScenarioWithRetry(workspace, exerciseDashboardBrowserScenario, {
      readinessChecks: [
        {
          requestPath: '/api/demo/dashboard',
          expectedText: 'id="dashboard-team"',
        },
      ],
      scenarioTimeoutMs: 45_000,
    });
  } finally {
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 150_000);

test('browser dashboard flows work in publish mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-dashboard-publish-', 'dashboard');
  let session: RuntimeSession | undefined;

  try {
    session = await startPublishSession(workspace, {
      readinessChecks: [
        {
          requestPath: '/api/demo/dashboard',
          expectedText: 'id="dashboard-team"',
        },
      ],
    });
    await exerciseDashboardPublishScenario(session.origin);
  } catch (error) {
    throw appendLogs(error, session?.getLogs() ?? {});
  } finally {
    if (session) {
      await session.stop();
    }
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

async function exerciseBrowserScenario(origin: string, progress?: ScenarioProgress): Promise<void> {
  const browser = await launchBrowser();
  try {
    setScenarioStep(progress, 'verify page lifecycle');
    await assertPageLifecycle(browser, origin);
    setScenarioStep(progress, 'verify prepared page');
    await assertPreparedPage(browser, origin);
    const fragmentContext = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const fragmentPage = await fragmentContext.newPage();

    try {
      setScenarioStep(progress, 'open progressive enhancement proof page');
      await fragmentPage.goto(`${origin}/api/demo/progressive-enhancement`, {
        waitUntil: 'domcontentloaded',
      });
      await fragmentPage.locator('h1').waitFor({ state: 'visible' });

      setScenarioStep(progress, 'verify document navigation scroll reset');
      await assertDocumentNavigationResetsScroll(fragmentPage, origin);
      setScenarioStep(progress, 'verify fragment update and focus handoff');
      await assertFragmentUpdateAndFocus(fragmentPage);
      setScenarioStep(progress, 'verify document navigation browser boundaries');
      await assertDocumentNavigationBoundaries(fragmentPage, origin);
      setScenarioStep(progress, 'bring the page metadata along');
      await assertHeadMetadataFollowsPage(fragmentPage, origin);
    } finally {
      await fragmentContext.close().catch(() => undefined);
    }

    const sessionContext = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const sessionPage = await sessionContext.newPage();

    try {
      setScenarioStep(progress, 'load session proof page');
      await sessionPage.goto(`${origin}/api/demo/progressive-enhancement`, {
        waitUntil: 'domcontentloaded',
      });
      await sessionPage.locator('#session-name').waitFor({ state: 'visible' });
      setScenarioStep(progress, 'exercise enhanced session flow');
      await assertSessionFlow(sessionPage);
      setScenarioStep(progress, 'follow a redirect to a section of the page');
      await assertRedirectKeepsFragment(sessionPage);
      setScenarioStep(progress, 'mark only the page on screen ready');
      await assertReadyFollowsCurrentPage(sessionPage, origin);
    } finally {
      await sessionContext.close().catch(() => undefined);
    }

    const baselineContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 },
    });
    const baselinePage = await baselineContext.newPage();

    try {
      setScenarioStep(progress, 'exercise baseline redirect flow');
      await assertNativeRedirectFlow(baselinePage, origin);
    } finally {
      await baselineContext.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// A redirect that names a section keeps it: client-nav follows the destination itself, lands on
// the section, and the page stops being busy once its script has run.
async function assertRedirectKeepsFragment(page: Page): Promise<void> {
  // The page is marked ready once its script has run, first load included.
  await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
  const entries = await page.evaluate(() => window.history.length);
  await page.locator('#demo-jump').click();
  await page.waitForFunction(
    () =>
      window.location.hash === '#session-panel' &&
      window.location.search === '?jumped=1' &&
      document.documentElement.hasAttribute('data-webstir-ready') &&
      !document.documentElement.hasAttribute('aria-busy'),
  );
  // The post and its redirect make one history entry, as a browser following it would.
  expect(await page.evaluate(() => window.history.length)).toBe(entries + 1);
  // Scrolled to the panel, or as far as the page allows when it is too short to bring the panel up.
  const { scrollY, expected } = await page.evaluate(() => {
    const panel = document.getElementById('session-panel')!;
    const top = panel.getBoundingClientRect().top + window.scrollY;
    const furthest = document.documentElement.scrollHeight - window.innerHeight;
    return { scrollY: window.scrollY, expected: Math.max(0, Math.min(top, furthest)) };
  });
  expect(Math.abs(scrollY - expected)).toBeLessThan(5);
}

// Ready belongs to the page on screen: a page whose setup is still running is not ready, and
// leaving it for a page with no script of its own makes that page ready without waiting.
async function assertReadyFollowsCurrentPage(page: Page, origin: string): Promise<void> {
  const html = (title: string, head: string, main: string) =>
    `<!doctype html><html><head><title>${title}</title>${head}</head><body><main>${main}</main></body></html>`;
  await page.route(`${origin}/client-nav-pending-setup.js`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/javascript' },
      body: 'export function setup() { return new Promise(() => {}); }',
    }),
  );
  await page.route(`${origin}/client-nav-pending-setup`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: html(
        'Pending Setup',
        '<script type="module" data-webstir-page src="/client-nav-pending-setup.js"></script>',
        '<h1 id="pending-setup-heading">Pending</h1><a id="to-scriptless" href="/client-nav-scriptless">on</a>',
      ),
    }),
  );
  await page.route(`${origin}/client-nav-scriptless`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: html('Scriptless', '', '<h1 id="scriptless-heading">Scriptless</h1>'),
    }),
  );

  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'to-pending-setup';
    link.href = '/client-nav-pending-setup';
    link.textContent = 'pending setup';
    document.body.append(link);
  });
  await page.locator('#to-pending-setup').click({ noWaitAfter: true });
  await page.locator('#pending-setup-heading').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.documentElement.hasAttribute('aria-busy'));
  expect(await page.locator('html[data-webstir-ready]').count()).toBe(0);

  await page.locator('#to-scriptless').click({ noWaitAfter: true });
  await page.locator('#scriptless-heading').waitFor({ state: 'visible' });
  await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
}

async function assertDocumentNavigationResetsScroll(page: Page, _origin: string): Promise<void> {
  // Navigate back to home via link click — verifies client-side or full navigation works.
  await page.locator('a[href="/"]').click({ noWaitAfter: true });
  await waitForPathname(page, '/');
  await page.locator('h1').waitFor({ state: 'visible' });

  expect(await page.locator('h1').textContent()).toBe('Home');
  // After a document navigation the scroll position should be at the top.
  // This holds for both client-side (scrollTo(0,0)) and full navigations (browser reset).
  await page.waitForFunction(() => window.scrollY === 0);

  await page.locator('a[href="/api/demo/progressive-enhancement"]').click({ noWaitAfter: true });
  await waitForPathname(page, '/api/demo/progressive-enhancement');
  await page.locator('#demo-name').waitFor({ state: 'visible' });
}

async function assertDocumentNavigationBoundaries(page: Page, origin: string): Promise<void> {
  let nonHtmlFallbackRequests = 0;
  let httpErrorFallbackRequests = 0;

  await page.route(`${origin}/client-nav-browser-fixture`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: [
        '<!doctype html>',
        '<html>',
        '<head><title>Client Nav Fixture</title></head>',
        '<body>',
        '<main>',
        '<h1 id="client-nav-fixture-heading">Client Nav Fixture</h1>',
        '<input id="client-nav-fixture-focus" autofocus>',
        '</main>',
        '</body>',
        '</html>',
      ].join(''),
    });
  });
  await page.route(`${origin}/client-nav-non-html-fixture`, async (route) => {
    nonHtmlFallbackRequests += 1;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route(`${origin}/client-nav-http-error-fixture`, async (route) => {
    httpErrorFallbackRequests += 1;
    await route.fulfill({
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<!doctype html><title>Not Found Fixture</title><main>Not Found Fixture</main>',
    });
  });

  await installClientNavRecorder(page);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'same-origin-document-fixture';
    link.href = '/client-nav-browser-fixture';
    link.textContent = 'Client nav fixture';
    document.body.append(link);
  });
  await page.locator('#same-origin-document-fixture').click({ noWaitAfter: true });
  await waitForPathname(page, '/client-nav-browser-fixture');
  await page.locator('#client-nav-fixture-heading').waitFor({ state: 'visible' });
  expect(await page.title()).toBe('Client Nav Fixture');
  expect(await readClientNavEvents(page)).toEqual(['/client-nav-browser-fixture']);

  await page.goto(`${origin}/api/demo/progressive-enhancement`, { waitUntil: 'load' });
  await page.locator('#demo-name').waitFor({ state: 'visible' });

  const linkResults = await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.innerHTML = [
      '<a id="external-link-fixture" href="https://example.com/outside">external</a>',
      '<a id="download-link-fixture" href="/download.txt" download>download</a>',
      '<a id="new-tab-link-fixture" href="/" target="_blank">new tab</a>',
      '<a id="anchor-link-fixture" href="#client-nav-anchor">anchor</a>',
      '<span id="client-nav-anchor">anchor target</span>',
      '<a id="target-link-fixture" href="/" target="named-frame">frame</a>',
      '<a id="ordinary-fixture" href="/">ordinary</a>',
      '<a id="opt-out-fixture" href="/" data-no-client-nav>native</a>',
    ].join('');
    document.body.append(fixture);

    const clickWasPrevented = (selector: string, options: MouseEventInit = {}) => {
      const link = document.querySelector(selector);
      if (!(link instanceof HTMLAnchorElement)) {
        throw new Error(`Missing fixture link ${selector}`);
      }
      let preventedByClientNav = false;
      const recorder = (event: MouseEvent) => {
        preventedByClientNav = event.defaultPrevented;
        event.preventDefault();
      };
      document.addEventListener('click', recorder, { once: true });
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...options,
      });
      link.dispatchEvent(event);
      document.removeEventListener('click', recorder);
      return preventedByClientNav;
    };

    return {
      external: clickWasPrevented('#external-link-fixture'),
      download: clickWasPrevented('#download-link-fixture'),
      newTab: clickWasPrevented('#new-tab-link-fixture'),
      sameDocumentAnchor: clickWasPrevented('#anchor-link-fixture'),
      namedTarget: clickWasPrevented('#target-link-fixture'),
      optOut: clickWasPrevented('#opt-out-fixture'),
      modified: clickWasPrevented('#ordinary-fixture', { ctrlKey: true }),
      middle: clickWasPrevented('#ordinary-fixture', { button: 1 }),
    };
  });

  expect(linkResults).toEqual({
    external: false,
    download: false,
    newTab: false,
    sameDocumentAnchor: false,
    namedTarget: false,
    optOut: false,
    modified: false,
    middle: false,
  });

  await installClientNavRecorder(page);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'non-html-navigation-fixture';
    link.href = '/client-nav-non-html-fixture';
    link.textContent = 'Non-HTML fixture';
    document.body.append(link);
  });
  await page.locator('#non-html-navigation-fixture').click({ noWaitAfter: true });
  await waitForPathname(page, '/client-nav-non-html-fixture');
  expect(nonHtmlFallbackRequests).toBeGreaterThan(0);
  expect(await readClientNavEvents(page)).toEqual([]);

  await page.goto(`${origin}/api/demo/progressive-enhancement`, { waitUntil: 'load' });
  await page.locator('#demo-name').waitFor({ state: 'visible' });
  await installClientNavRecorder(page);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.id = 'http-error-navigation-fixture';
    link.href = '/client-nav-http-error-fixture';
    link.textContent = 'HTTP error fixture';
    document.body.append(link);
  });
  await page.locator('#http-error-navigation-fixture').click({ noWaitAfter: true });
  await waitForPathname(page, '/client-nav-http-error-fixture');
  expect(httpErrorFallbackRequests).toBeGreaterThan(0);
  expect(await readClientNavEvents(page)).toEqual([]);

  await page.goto(`${origin}/api/demo/progressive-enhancement`, { waitUntil: 'load' });
  await page.locator('#demo-name').waitFor({ state: 'visible' });
}

// The title, named meta and page links follow the page on screen. A relative canonical resolves
// against the page's own <base>, not this document's, and a javascript: canonical is left out.
// The referrer policy never changes in place: a page that sets another one, by meta (in <head> or
// <main>) or header, loads in full and the browser applies it; pages with the same policy, or
// none, stay client-side.
async function assertHeadMetadataFollowsPage(page: Page, origin: string): Promise<void> {
  // Fixture pages load the app's own scripts, so client-nav runs on those that load in full.
  const appScripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[type="module"][src]'))
      .filter((script) => !script.hasAttribute('data-webstir-page'))
      .map((script) => `<script type="module" src="${script.getAttribute('src')}"></script>`)
      .join(''),
  );
  const html = (title: string, head: string, main: string) =>
    `<!doctype html><html><head><title>${title}</title>${head}${appScripts}</head><body><main>${main}</main></body></html>`;
  const link = (id: string, href: string) => `<a id="${id}" href="${href}">on</a>`;
  const referers = new Map<string, string[]>();
  const fixture = async (
    pathname: string,
    body: string,
    headers: Record<string, string> = {},
  ): Promise<void> => {
    await page.route(`${origin}${pathname}`, async (route) => {
      const seen = referers.get(pathname) ?? [];
      seen.push((await route.request().allHeaders()).referer ?? '');
      referers.set(pathname, seen);
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
        body,
      });
    });
  };
  await fixture(
    '/client-nav-meta-a',
    html(
      'Meta A',
      '<base href="/client-nav-base/"><meta name="description" content="A">' +
        '<meta name="robots" content="noindex"><link rel="canonical" href="client-nav-meta-a">',
      `<h1 id="meta-a-heading">Meta A</h1>${link('to-meta-b', '/client-nav-meta-b')}`,
    ),
  );
  // Its frame starts loading the moment the content goes in.
  await fixture(
    '/client-nav-meta-b',
    html(
      '',
      '<link rel="canonical" href="javascript:alert(1)">',
      '<h1 id="meta-b-heading">Meta B</h1><iframe src="/client-nav-frame"></iframe>' +
        link('to-no-referrer', '/client-nav-no-referrer'),
    ),
  );
  await fixture('/client-nav-frame', '<!doctype html><p>frame</p>');
  await fixture(
    '/client-nav-no-referrer',
    html(
      'No Referrer',
      '<meta name="referrer" content="no-referrer">',
      `<h1 id="no-referrer-heading">No Referrer</h1>${link('to-no-referrer-header', '/client-nav-no-referrer-header')}`,
    ),
  );
  await fixture(
    '/client-nav-no-referrer-header',
    html(
      'No Referrer Header',
      '',
      `<h1 id="no-referrer-header-heading">No Referrer Header</h1>${link('to-unsafe', '/client-nav-unsafe')}`,
    ),
    { 'referrer-policy': 'no-referrer' },
  );
  await fixture(
    '/client-nav-unsafe',
    html(
      'Unsafe',
      '<meta name="referrer" content="unsafe-url">',
      `<h1 id="unsafe-heading">Unsafe</h1>${link('to-main-origin', '/client-nav-main-origin')}`,
    ),
  );
  await fixture(
    '/client-nav-main-origin',
    html(
      'Main Origin',
      '',
      '<meta name="referrer" content="origin"><h1 id="main-origin-heading">Main Origin</h1>' +
        link('to-head-origin', '/client-nav-head-origin'),
    ),
  );
  // The same policy, set in <head> this time: it stays client-side, keeps the policy though the
  // meta it came from leaves with <main>, and a page with none after it loads in full.
  await fixture(
    '/client-nav-head-origin',
    html(
      'Head Origin',
      '<meta name="referrer" content="origin">',
      `<h1 id="head-origin-heading">Head Origin</h1>${link('to-plain', '/client-nav-plain')}`,
    ),
  );
  await fixture(
    '/client-nav-plain',
    html(
      'Plain',
      '',
      '<h1 id="plain-heading">Plain</h1>' +
        '<form id="policy-form" method="post" action="/client-nav-form-policy">' +
        '<button id="policy-form-submit">Send</button></form>',
    ),
  );
  // A form answered with a document that sets another policy loads that address in full.
  await page.route(`${origin}/client-nav-form-policy`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body:
        route.request().method() === 'POST'
          ? html('Posted', '<meta name="referrer" content="no-referrer">', '<h1>Posted</h1>')
          : html(
              'Form Policy',
              '',
              '<h1 id="form-policy-heading">Form Policy</h1>' +
                '<form method="post" action="/client-nav-form-refused">' +
                '<input name="email" value="not-an-email">' +
                '<button id="refused-form-submit">Send</button></form>',
            ),
    }),
  );
  // A refused post (a re-rendered form) is posted again natively, so its own response, errors
  // included, is what the browser shows under the policy it sets; unless the form changed while
  // the first post was in flight, when its address loads instead of sending the new values.
  const refusedRequests: string[] = [];
  let holdRefused: Promise<void> | undefined;
  // Any other failure may follow a change the action made, so it is never posted twice.
  const failedRequests: string[] = [];
  await page.route(`${origin}/client-nav-form-failed`, async (route) => {
    const request = route.request();
    failedRequests.push(`${request.method()} ${request.postData() ?? ''}`);
    await route.fulfill({
      status: request.method() === 'POST' ? 500 : 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body:
        request.method() === 'POST'
          ? html('Failed', '<meta name="referrer" content="no-referrer">', '<h1>Failed</h1>')
          : html(
              'Failed Form',
              '',
              '<h1 id="failed-form-heading">Failed Form</h1>' +
                '<form method="post" action="/client-nav-form-refused">' +
                '<input name="email" value="not-an-email">' +
                '<button id="refused-again-submit">Send</button></form>',
            ),
    });
  });
  await page.route(`${origin}/client-nav-form-refused`, async (route) => {
    const request = route.request();
    refusedRequests.push(`${request.method()} ${request.postData() ?? ''}`);
    if (request.method() !== 'POST') {
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: html(
          'Refused Form',
          '',
          '<h1 id="refused-form-heading">Refused Form</h1>' +
            '<form method="post" action="/client-nav-form-failed">' +
            '<button id="failed-form-submit">Send</button></form>',
        ),
      });
      return;
    }
    await holdRefused;
    await route.fulfill({
      status: 422,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: html(
        'Refused',
        '<meta name="referrer" content="no-referrer">',
        '<h1 id="refused-heading">Refused</h1>' +
          '<form method="post" action="/client-nav-redirect">' +
          '<button id="redirect-form-submit">Send</button></form>',
      ),
    });
  });
  // A redirect from a page that sets a policy loads its destination in full without fetching it
  // first, so what the destination shows once (a flash message) is not spent on a thrown-away copy.
  await page.route(`${origin}/client-nav-redirect`, (route) =>
    route.fulfill({
      status: 204,
      headers: { 'x-webstir-location': '/client-nav-destination#section' },
    }),
  );
  await fixture(
    '/client-nav-destination',
    html('Destination', '', '<h1 id="destination-heading">Destination</h1><p id="section">s</p>'),
  );
  await page.route(`${origin}/client-nav-referer-probe`, async (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: (await route.request().allHeaders()).referer ?? '',
    }),
  );
  const probeReferer = () =>
    page.evaluate(() => fetch('/client-nav-referer-probe').then((response) => response.text()));
  const readMetadata = () =>
    page.evaluate(() => ({
      description:
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null,
      viewport: document.querySelectorAll('meta[name="viewport"]').length,
    }));
  // A marker on the window tells a client-side navigation (it survives) from a full load.
  const markDocument = () =>
    page.evaluate(() => {
      (window as typeof window & { __clientNavDocument?: boolean }).__clientNavDocument = true;
    });
  const sameDocument = () =>
    page.evaluate(
      () =>
        (window as typeof window & { __clientNavDocument?: boolean }).__clientNavDocument === true,
    );
  const go = async (linkId: string, headingId: string) => {
    await page.locator(`#${linkId}`).click({ noWaitAfter: true });
    await page.locator(`#${headingId}`).waitFor({ state: 'visible' });
    await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
  };

  const viewport = (await readMetadata()).viewport;
  await markDocument();
  await page.evaluate(() => {
    const anchor = document.createElement('a');
    anchor.id = 'to-meta-a';
    anchor.href = '/client-nav-meta-a';
    anchor.textContent = 'meta a';
    document.body.append(anchor);
  });
  await go('to-meta-a', 'meta-a-heading');
  expect(await sameDocument()).toBe(true);
  expect(await page.title()).toBe('Meta A');
  expect(await readMetadata()).toEqual({
    description: 'A',
    robots: 'noindex',
    canonical: `${origin}/client-nav-base/client-nav-meta-a`,
    viewport,
  });

  await go('to-meta-b', 'meta-b-heading');
  expect(await sameDocument()).toBe(true);
  expect(await page.title()).toBe('');
  expect(await readMetadata()).toEqual({
    description: null,
    robots: null,
    canonical: null,
    viewport,
  });
  expect(await probeReferer()).toBe(`${origin}/client-nav-meta-b`);
  await waitFor(async () => expect(referers.get('/client-nav-frame')).toBeDefined(), 5_000);
  expect(referers.get('/client-nav-frame')).toEqual([`${origin}/client-nav-meta-b`]);

  // A referrer meta the page on screen lacks: a full load, and the browser applies it.
  await go('to-no-referrer', 'no-referrer-heading');
  expect(await sameDocument()).toBe(false);
  expect(await probeReferer()).toBe('');

  // The same policy by header: client-side.
  await markDocument();
  await go('to-no-referrer-header', 'no-referrer-header-heading');
  expect(await sameDocument()).toBe(true);
  expect(await probeReferer()).toBe('');

  // A looser meta is read from the response text, not parsed, so the page on screen keeps its
  // policy until it leaves: the full load's own request sends no Referer either.
  await go('to-unsafe', 'unsafe-heading');
  expect(await sameDocument()).toBe(false);
  expect(referers.get('/client-nav-unsafe')).toEqual(['', '']);
  expect(await probeReferer()).toBe(`${origin}/client-nav-unsafe`);

  // A referrer meta inside <main> counts too.
  await go('to-main-origin', 'main-origin-heading');
  expect(await sameDocument()).toBe(false);
  expect(await probeReferer()).toBe(`${origin}/`);

  // The same policy in <head>: client-side; then a page with none: a full load.
  await markDocument();
  await go('to-head-origin', 'head-origin-heading');
  expect(await sameDocument()).toBe(true);
  expect(await probeReferer()).toBe(`${origin}/`);
  await go('to-plain', 'plain-heading');
  expect(await sameDocument()).toBe(false);
  expect(await probeReferer()).toBe(`${origin}/client-nav-plain`);

  await markDocument();
  await page.locator('#policy-form-submit').click({ noWaitAfter: true });
  await page.locator('#form-policy-heading').waitFor({ state: 'visible' });
  expect(await sameDocument()).toBe(false);

  await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
  let releaseRefused = () => {};
  holdRefused = new Promise<void>((resolve) => {
    releaseRefused = resolve;
  });
  const firstPost = page.waitForRequest(`${origin}/client-nav-form-refused`);
  await page.locator('#refused-form-submit').click({ noWaitAfter: true });
  await firstPost;
  await page.locator('input[name="email"]').fill('changed@example.com');
  releaseRefused();
  await page.locator('#refused-form-heading').waitFor({ state: 'visible' });
  expect(refusedRequests).toEqual(['POST email=not-an-email', 'GET ']);
  holdRefused = undefined;

  await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
  await page.locator('#failed-form-submit').click({ noWaitAfter: true });
  await page.locator('#failed-form-heading').waitFor({ state: 'visible' });
  expect(failedRequests).toEqual(['POST ', 'GET ']);

  await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
  await markDocument();
  await page.locator('#refused-again-submit').click({ noWaitAfter: true });
  await page.locator('#refused-heading').waitFor({ state: 'visible' });
  expect(await sameDocument()).toBe(false);
  // The native repost carries the same submission id.
  expect(refusedRequests.slice(2)).toEqual([
    'POST email=not-an-email',
    expect.stringMatching(/^POST email=not-an-email&_webstir_submission=[\w-]+$/),
  ]);
  expect(await probeReferer()).toBe('');

  await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
  await page.locator('#redirect-form-submit').click({ noWaitAfter: true });
  await page.locator('#destination-heading').waitFor({ state: 'visible' });
  expect(new URL(page.url()).hash).toBe('#section');
  expect(referers.get('/client-nav-destination')).toEqual(['']);

  // Back onto an entry that now redirects, from a page that sets a policy: the destination
  // replaces that entry, as a browser following the redirect would, so Forward still works.
  let bounce = false;
  await page.route(`${origin}/client-nav-bounce`, (route) =>
    bounce
      ? route.fulfill({
          status: 204,
          headers: { 'x-webstir-location': '/client-nav-bounced' },
        })
      : route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          body: html(
            'Bounce',
            '<meta name="referrer" content="no-referrer">',
            `<h1 id="bounce-heading">Bounce</h1>${link('to-bounce-next', '/client-nav-bounce-next')}`,
          ),
        }),
  );
  await fixture(
    '/client-nav-bounce-next',
    html(
      'Bounce Next',
      '<meta name="referrer" content="no-referrer">',
      '<h1 id="bounce-next-heading">Bounce Next</h1>',
    ),
  );
  await fixture(
    '/client-nav-bounced',
    html('Bounced', '', '<h1 id="bounced-heading">Bounced</h1>'),
  );
  await page.goto(`${origin}/client-nav-bounce`, { waitUntil: 'load' });
  await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
  await markDocument();
  await go('to-bounce-next', 'bounce-next-heading');
  expect(await sameDocument()).toBe(true);
  bounce = true;
  await page.goBack({ waitUntil: 'commit' });
  await page.locator('#bounced-heading').waitFor({ state: 'visible' });
  await page.goForward({ waitUntil: 'commit' });
  await page.waitForURL(`${origin}/client-nav-bounce-next`);

  await page.goto(`${origin}/api/demo/progressive-enhancement`, { waitUntil: 'load' });
  await page.locator('#demo-name').waitFor({ state: 'visible' });
}

async function assertFragmentUpdateAndFocus(page: Page): Promise<void> {
  await page.locator('#demo-name').fill('Enhanced Browser');

  await page.locator('#demo-update-greeting').click();
  await page.waitForFunction(
    () => document.querySelector('#greeting-preview h2')?.textContent === 'Hello, Enhanced Browser',
  );
  await page.waitForFunction(() => document.activeElement?.id === 'greeting-update-focus');

  expect(new URL(page.url()).pathname).toBe('/api/demo/progressive-enhancement');
  expect(await page.locator('#greeting-preview').textContent()).toContain(
    'replace just this region',
  );
}

async function assertSessionFlow(page: Page): Promise<void> {
  await page.locator('#session-name').fill('Casey Browser');

  await page.locator('#demo-sign-in').click();
  await page.waitForFunction(
    () => document.querySelector('#session-user')?.textContent?.trim() === 'Casey Browser',
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#session-user').waitFor({ state: 'visible' });
  expect(await page.locator('#session-user').textContent()).toBe('Casey Browser');

  await page.locator('#demo-sign-out').click();
  await page.locator('#demo-sign-in').waitFor({ state: 'visible' });

  await page.waitForFunction(
    () =>
      window.location.pathname === '/api/demo/progressive-enhancement' &&
      window.location.search === '',
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#demo-sign-in').waitFor({ state: 'visible' });
  expect(await page.locator('#session-status').textContent()).toContain('Not signed in');
}

async function assertNativeRedirectFlow(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/api/demo/progressive-enhancement`, { waitUntil: 'domcontentloaded' });
  await page.locator('#demo-name').fill('Native Browser');

  await page.locator('#greeting-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.waitForFunction(
    () =>
      window.location.pathname === '/api/demo/progressive-enhancement' &&
      window.location.search === '?source=redirect&name=Native%20Browser',
  );

  await page.locator('#greeting-preview').waitFor({ state: 'visible' });
  expect(await page.locator('#greeting-preview').textContent()).toContain('Hello, Native Browser');
  expect(await page.locator('body').textContent()).toContain(
    'Last submit used the no-JavaScript redirect path.',
  );
}

async function exerciseAuthCrudBrowserScenario(
  origin: string,
  progress?: ScenarioProgress,
): Promise<void> {
  const browser = await launchBrowser();
  try {
    const enhancedContext = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const enhancedPage = await enhancedContext.newPage();

    try {
      setScenarioStep(progress, 'load enhanced auth-crud page');
      await enhancedPage.goto(`${origin}/api/demo/auth-crud`, { waitUntil: 'domcontentloaded' });
      await enhancedPage.locator('#auth-email').waitFor({ state: 'visible' });

      setScenarioStep(progress, 'sign in enhanced auth-crud session');
      await enhancedPage.locator('#auth-email').fill('casey.browser@example.com');
      await enhancedPage.locator('#auth-sign-in').click();
      await enhancedPage.waitForFunction(
        () =>
          document
            .querySelector('#session-user')
            ?.textContent?.includes('casey.browser@example.com') ?? false,
      );

      setScenarioStep(progress, 'submit invalid enhanced create form');
      await enhancedPage.locator('#project-title').fill('');
      await enhancedPage.locator('#project-notes').fill('This should fail first.');
      await enhancedPage.locator('#project-create-submit').click();
      await enhancedPage.locator('text=Project title is required.').waitFor({ state: 'visible' });

      setScenarioStep(progress, 'create enhanced auth-crud project');
      await enhancedPage.locator('#project-title').fill('Browser launch checklist');
      await enhancedPage.locator('#project-status').selectOption('active');
      await enhancedPage
        .locator('#project-notes')
        .fill('Created through the enhanced fragment path.');
      await enhancedPage.locator('#project-create-submit').click();
      await enhancedPage.waitForFunction(
        () =>
          document.body.textContent?.includes('Created project "Browser launch checklist".') ??
          false,
      );

      const projectRow = enhancedPage.locator('[data-project-row="true"]').first();
      const projectId = await projectRow.getAttribute('data-project-id');
      if (!projectId) {
        throw new Error('Expected a created project row.');
      }

      setScenarioStep(progress, 'update enhanced auth-crud project');
      await projectRow.locator('input[name="title"]').fill('Browser launch checklist updated');
      await projectRow
        .locator('textarea[name="notes"]')
        .fill('Updated through the enhanced fragment path.');
      await enhancedPage
        .locator(`#project-edit-form-${projectId}`)
        .evaluate((form: HTMLFormElement) => form.requestSubmit());
      await enhancedPage.waitForFunction(
        (id) =>
          document.querySelector(`[data-project-id="${id}"] h4`)?.textContent ===
          'Browser launch checklist updated',
        projectId,
      );

      setScenarioStep(progress, 'reload enhanced auth-crud page');
      await enhancedPage.reload({ waitUntil: 'domcontentloaded' });
      await enhancedPage.locator(`[data-project-id="${projectId}"]`).waitFor({ state: 'visible' });
      expect(await enhancedPage.locator(`[data-project-id="${projectId}"] h4`).textContent()).toBe(
        'Browser launch checklist updated',
      );

      setScenarioStep(progress, 'delete enhanced auth-crud project');
      await enhancedPage
        .locator(`#project-delete-form-${projectId}`)
        .evaluate((form: HTMLFormElement) => form.requestSubmit());
      await enhancedPage.waitForFunction(
        (id) => !document.querySelector(`[data-project-id="${id}"]`),
        projectId,
      );
      expect(await enhancedPage.locator('#flash-region').textContent()).toContain(
        'Deleted project "Browser launch checklist updated".',
      );
    } finally {
      await enhancedContext.close().catch(() => undefined);
    }

    const baselineContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 },
    });
    const baselinePage = await baselineContext.newPage();

    try {
      setScenarioStep(progress, 'load baseline auth-crud page');
      await baselinePage.goto(`${origin}/api/demo/auth-crud`, { waitUntil: 'domcontentloaded' });
      setScenarioStep(progress, 'verify baseline auth redirect');
      await baselinePage.locator('#project-title').fill('Native blocked project');
      await baselinePage.locator('#project-notes').fill('Expect an auth redirect.');
      await baselinePage
        .locator('#project-create-form')
        .evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(
        () =>
          window.location.pathname === '/api/demo/auth-crud' &&
          document.body.textContent?.includes('Sign in required to manage projects.'),
      );
      expect(new URL(baselinePage.url()).pathname).toBe('/api/demo/auth-crud');
      expect(await baselinePage.locator('body').textContent()).toContain(
        'Sign in required to manage projects.',
      );

      setScenarioStep(progress, 'sign in baseline auth-crud session');
      await baselinePage.locator('#auth-email').fill('native@example.com');
      await baselinePage
        .locator('#auth-sign-in-form')
        .evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(
        () =>
          window.location.pathname === '/api/demo/auth-crud' &&
          document.body.textContent?.includes('Signed in as native@example.com.'),
      );
      expect(new URL(baselinePage.url()).pathname).toBe('/api/demo/auth-crud');
      expect(await baselinePage.locator('body').textContent()).toContain(
        'Signed in as native@example.com.',
      );

      setScenarioStep(progress, 'create baseline auth-crud project');
      await baselinePage.locator('#project-title').fill('Native create project');
      await baselinePage.locator('#project-status').selectOption('active');
      await baselinePage
        .locator('#project-notes')
        .fill('Created through the no-JavaScript redirect path.');
      await baselinePage
        .locator('#project-create-form')
        .evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(
        () =>
          window.location.pathname === '/api/demo/auth-crud' &&
          document.body.textContent?.includes('Created project "Native create project".'),
      );
      expect(new URL(baselinePage.url()).pathname).toBe('/api/demo/auth-crud');
      expect(await baselinePage.locator('body').textContent()).toContain(
        'Created project "Native create project".',
      );

      expect(await baselinePage.locator('body').textContent()).toContain('Native create project');
    } finally {
      await baselineContext.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function exerciseAuthCrudPublishScenario(origin: string): Promise<void> {
  const initial = await requestHtmlDocument(origin, '/api/demo/auth-crud');
  const signInCsrf = extractFormInputValue(initial.html, 'auth-sign-in-form', '_csrf');
  const signInResponse = await requestWithCookie(
    origin,
    '/api/demo/auth-crud/session/sign-in',
    initial.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `_csrf=${encodeURIComponent(signInCsrf)}&email=${encodeURIComponent('casey.browser@example.com')}`,
      redirect: 'manual',
    },
  );

  expect(signInResponse.status).toBe(303);
  expect(signInResponse.headers.get('location')).toBe('/api/demo/auth-crud');

  const signedInCookie = coalesceCookie(signInResponse.headers.get('set-cookie'), initial.cookie);
  const signedIn = await requestHtmlDocument(origin, '/api/demo/auth-crud', signedInCookie);
  expect(signedIn.html).toContain('Signed in as <strong>casey.browser@example.com</strong>.');

  const invalidCreateCsrf = extractFormInputValue(signedIn.html, 'project-create-form', '_csrf');
  const invalidCreateResponse = await requestWithCookie(
    origin,
    '/api/demo/auth-crud/projects/create',
    signedIn.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-webstir-client-nav': '1',
      },
      body: `_csrf=${encodeURIComponent(invalidCreateCsrf)}&title=&status=active&notes=${encodeURIComponent('This should fail first.')}`,
    },
  );
  const invalidCreateHtml = await invalidCreateResponse.text();

  expect(invalidCreateResponse.status).toBe(422);
  expect(invalidCreateResponse.headers.get('x-webstir-fragment-target')).toBe('backoffice-shell');
  expect(invalidCreateHtml).toContain('Project title is required.');

  const createCsrf = extractFormInputValue(signedIn.html, 'project-create-form', '_csrf');
  const createResponse = await requestWithCookie(
    origin,
    '/api/demo/auth-crud/projects/create',
    signedIn.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: [
        `_csrf=${encodeURIComponent(createCsrf)}`,
        `title=${encodeURIComponent('Browser launch checklist')}`,
        'status=active',
        `notes=${encodeURIComponent('Created through the publish redirect path.')}`,
      ].join('&'),
      redirect: 'manual',
    },
  );

  expect(createResponse.status).toBe(303);
  expect(createResponse.headers.get('location')).toBe('/api/demo/auth-crud');

  const afterCreate = await requestHtmlDocument(origin, '/api/demo/auth-crud', signedIn.cookie);
  expect(afterCreate.html).toContain('Created project &quot;Browser launch checklist&quot;.');
  expect(afterCreate.html).toContain('Browser launch checklist');

  const projectId = extractFirstEntityId(afterCreate.html, 'project');
  const updateCsrf = extractFormInputValue(
    afterCreate.html,
    `project-edit-form-${projectId}`,
    '_csrf',
  );
  const updateResponse = await requestWithCookie(
    origin,
    '/api/demo/auth-crud/projects/update',
    signedIn.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-webstir-client-nav': '1',
      },
      body: [
        `_csrf=${encodeURIComponent(updateCsrf)}`,
        `projectId=${encodeURIComponent(projectId)}`,
        `title=${encodeURIComponent('Operations cleanup updated')}`,
        'status=archived',
        `notes=${encodeURIComponent('Persist this edit across the next document request.')}`,
      ].join('&'),
    },
  );
  const updateHtml = await updateResponse.text();

  expect(updateResponse.status).toBe(200);
  expect(updateResponse.headers.get('x-webstir-fragment-target')).toBe('backoffice-shell');
  expect(updateHtml).toContain('Operations cleanup updated');

  const afterUpdate = await requestHtmlDocument(origin, '/api/demo/auth-crud', signedIn.cookie);
  expect(afterUpdate.html).toContain('Operations cleanup updated');

  const deleteCsrf = extractFormInputValue(
    afterUpdate.html,
    `project-delete-form-${projectId}`,
    '_csrf',
  );
  const deleteResponse = await requestWithCookie(
    origin,
    '/api/demo/auth-crud/projects/delete',
    signedIn.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-webstir-client-nav': '1',
      },
      body: `_csrf=${encodeURIComponent(deleteCsrf)}&projectId=${encodeURIComponent(projectId)}`,
    },
  );
  const deleteHtml = await deleteResponse.text();

  expect(deleteResponse.status).toBe(200);
  expect(deleteResponse.headers.get('x-webstir-fragment-target')).toBe('backoffice-shell');
  expect(deleteHtml.includes(`project-edit-form-${projectId}`)).toBe(false);

  const afterDelete = await requestHtmlDocument(origin, '/api/demo/auth-crud', signedIn.cookie);
  expect(afterDelete.html.includes(`project-edit-form-${projectId}`)).toBe(false);
}

async function exerciseDashboardBrowserScenario(
  origin: string,
  progress?: ScenarioProgress,
): Promise<void> {
  const browser = await launchBrowser();
  try {
    const enhancedContext = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const enhancedPage = await enhancedContext.newPage();

    try {
      setScenarioStep(progress, 'load enhanced dashboard page');
      await enhancedPage.goto(`${origin}/api/demo/dashboard`, { waitUntil: 'domcontentloaded' });
      await enhancedPage.locator('#dashboard-team').waitFor({ state: 'visible' });

      setScenarioStep(progress, 'apply enhanced dashboard filters');
      await enhancedPage.locator('#dashboard-team').selectOption('growth');
      await enhancedPage.locator('#dashboard-range').selectOption('month');
      await enhancedPage.locator('#dashboard-apply-filters').click();
      await enhancedPage.waitForFunction(
        () =>
          document.querySelector('#dashboard-heading')?.textContent ===
          'Dashboard focus: Growth · last 30 days',
      );

      setScenarioStep(progress, 'refresh enhanced dashboard metrics');
      const enhancedRefreshCount = await readRefreshCount(enhancedPage);
      await enhancedPage.locator('#metrics-refresh').click();
      await enhancedPage.waitForFunction((previousCount) => {
        const text = document.querySelector('#metrics-refresh-count')?.textContent ?? '';
        const match = text.match(/Refresh count: (\d+)/);
        return match ? Number(match[1]) > previousCount : false;
      }, enhancedRefreshCount);

      const alertRow = enhancedPage.locator('[data-alert-row="true"]').first();
      const alertId = await alertRow.getAttribute('data-alert-id');
      if (!alertId) {
        throw new Error('Expected an alert row in the dashboard proof app.');
      }

      setScenarioStep(progress, 'acknowledge enhanced dashboard alert');
      await enhancedPage.locator(`#acknowledge-alert-${alertId}`).click();
      await enhancedPage.waitForFunction(
        (id) => !document.querySelector(`[data-alert-id="${id}"]`),
        alertId,
      );
      expect(await enhancedPage.locator('#alerts-status').textContent()).toContain('Acknowledged');

      setScenarioStep(progress, 'reload enhanced dashboard page');
      await enhancedPage.reload({ waitUntil: 'domcontentloaded' });
      await enhancedPage.locator('#dashboard-heading').waitFor({ state: 'visible' });
      expect(await enhancedPage.locator('#dashboard-heading').textContent()).toBe(
        'Dashboard focus: Growth · last 30 days',
      );
      expect(await readRefreshCount(enhancedPage)).toBeGreaterThan(enhancedRefreshCount);
      expect(await enhancedPage.locator(`[data-alert-id="${alertId}"]`).count()).toBe(0);
    } finally {
      await enhancedContext.close().catch(() => undefined);
    }

    const baselineContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 },
    });
    const baselinePage = await baselineContext.newPage();

    try {
      setScenarioStep(progress, 'load baseline dashboard page');
      await baselinePage.goto(`${origin}/api/demo/dashboard`, { waitUntil: 'domcontentloaded' });
      setScenarioStep(progress, 'submit baseline dashboard filters');
      await baselinePage.locator('#dashboard-team').selectOption('north');
      await baselinePage.locator('#dashboard-range').selectOption('today');
      await baselinePage
        .locator('#dashboard-filter-form')
        .evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(
        () =>
          window.location.pathname === '/api/demo/dashboard' &&
          document.body.textContent?.includes('Filtered to North region for today.'),
      );

      setScenarioStep(progress, 'refresh baseline dashboard metrics');
      const baselineRefreshCount = await readRefreshCount(baselinePage);
      await baselinePage
        .locator('#metrics-refresh-form')
        .evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(
        () =>
          window.location.pathname === '/api/demo/dashboard' &&
          document.body.textContent?.includes('Snapshot refreshed 1 time for North region.'),
      );

      expect(await baselinePage.locator('#dashboard-heading').textContent()).toBe(
        'Dashboard focus: North region · today',
      );
      expect(await readRefreshCount(baselinePage)).toBeGreaterThan(baselineRefreshCount);
    } finally {
      await baselineContext.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function exerciseDashboardPublishScenario(origin: string): Promise<void> {
  const initial = await requestHtmlDocument(origin, '/api/demo/dashboard');

  const nativeFilterCsrf = extractFormInputValue(initial.html, 'dashboard-filter-form', '_csrf');
  const nativeFilterResponse = await requestWithCookie(
    origin,
    '/api/demo/dashboard/context',
    initial.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `_csrf=${encodeURIComponent(nativeFilterCsrf)}&team=growth&range=month`,
      redirect: 'manual',
    },
  );

  expect(nativeFilterResponse.status).toBe(303);
  expect(nativeFilterResponse.headers.get('location')).toBe('/api/demo/dashboard');

  const filtered = await requestHtmlDocument(origin, '/api/demo/dashboard', initial.cookie);
  expect(filtered.html).toContain('Dashboard focus: Growth · last 30 days');
  expect(filtered.html).toContain('Filtered to Growth for last 30 days.');

  const enhancedFilterCsrf = extractFormInputValue(filtered.html, 'dashboard-filter-form', '_csrf');
  const enhancedFilterResponse = await requestWithCookie(
    origin,
    '/api/demo/dashboard/context',
    filtered.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-webstir-client-nav': '1',
      },
      body: `_csrf=${encodeURIComponent(enhancedFilterCsrf)}&team=north&range=today`,
    },
  );
  const enhancedFilterHtml = await enhancedFilterResponse.text();

  expect(enhancedFilterResponse.status).toBe(200);
  expect(enhancedFilterResponse.headers.get('x-webstir-fragment-target')).toBe('dashboard-shell');
  expect(enhancedFilterHtml).toContain('Dashboard focus: North region · today');

  const refreshCsrf = extractFormInputValue(filtered.html, 'metrics-refresh-form', '_csrf');
  const refreshResponse = await requestWithCookie(
    origin,
    '/api/demo/dashboard/metrics/refresh',
    filtered.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-webstir-client-nav': '1',
      },
      body: `_csrf=${encodeURIComponent(refreshCsrf)}`,
    },
  );
  const refreshHtml = await refreshResponse.text();

  expect(refreshResponse.status).toBe(200);
  expect(refreshResponse.headers.get('x-webstir-fragment-target')).toBe('metrics-panel');
  expect(refreshHtml).toContain('Refresh count: 1');

  const refreshed = await requestHtmlDocument(origin, '/api/demo/dashboard', filtered.cookie);
  expect(refreshed.html).toContain('Refresh count: 1');

  const alertId = extractFirstEntityId(refreshed.html, 'alert');
  const acknowledgeCsrf = extractFormInputValue(
    refreshed.html,
    `acknowledge-alert-form-${alertId}`,
    '_csrf',
  );
  const acknowledgeResponse = await requestWithCookie(
    origin,
    '/api/demo/dashboard/alerts/acknowledge',
    filtered.cookie,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'x-webstir-client-nav': '1',
      },
      body: `_csrf=${encodeURIComponent(acknowledgeCsrf)}&alertId=${encodeURIComponent(alertId)}`,
    },
  );
  const acknowledgeHtml = await acknowledgeResponse.text();

  expect(acknowledgeResponse.status).toBe(200);
  expect(acknowledgeResponse.headers.get('x-webstir-fragment-target')).toBe('alerts-panel');
  expect(acknowledgeHtml.includes(`data-alert-id="${alertId}"`)).toBe(false);

  const afterAcknowledge = await requestHtmlDocument(
    origin,
    '/api/demo/dashboard',
    filtered.cookie,
  );
  expect(afterAcknowledge.html.includes(`data-alert-id="${alertId}"`)).toBe(false);
}

async function readRefreshCount(page: Page): Promise<number> {
  const text = await page.locator('#metrics-refresh-count').textContent();
  const match = text?.match(/Refresh count: (\d+)/);
  if (!match) {
    throw new Error(`Expected a refresh count chip, received: ${text ?? '(empty)'}`);
  }

  return Number(match[1]);
}

async function waitForPathname(page: Page, pathname: string): Promise<void> {
  await page.waitForFunction(
    (expectedPathname) => window.location.pathname === expectedPathname,
    pathname,
  );
}

async function installClientNavRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __webstirClientNavEvents?: string[];
      __webstirClientNavRecorderInstalled?: boolean;
    };
    targetWindow.__webstirClientNavEvents = [];
    if (targetWindow.__webstirClientNavRecorderInstalled) {
      return;
    }
    targetWindow.__webstirClientNavRecorderInstalled = true;
    window.addEventListener('webstir:client-nav', (event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      const url = typeof detail?.url === 'string' ? detail.url : window.location.href;
      targetWindow.__webstirClientNavEvents?.push(new URL(url, window.location.href).pathname);
    });
  });
}

async function readClientNavEvents(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const targetWindow = window as typeof window & {
      __webstirClientNavEvents?: string[];
    };
    return targetWindow.__webstirClientNavEvents ?? [];
  });
}

async function launchBrowser(): Promise<Browser> {
  return await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
}

async function copyDemoWorkspace(prefix: string, fixtureName: string): Promise<string> {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', fixtureName);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const workspace = path.join(tempRoot, fixtureName);
  await cp(fixtureRoot, workspace, { recursive: true });
  await Promise.all([
    rm(path.join(workspace, 'build'), { recursive: true, force: true }),
    rm(path.join(workspace, 'dist'), { recursive: true, force: true }),
    rm(path.join(workspace, 'node_modules'), { recursive: true, force: true }),
    rm(path.join(workspace, '.webstir'), { recursive: true, force: true }),
  ]);
  if (fixtureName === 'full') {
    const preparedRoot = path.join(workspace, 'src/frontend/pages/prepared');
    await mkdir(preparedRoot, { recursive: true });
    await writeFile(
      path.join(preparedRoot, 'index.html'),
      `<head><title>Prepared</title><script type="module" src="index.js" data-webstir-load></script></head><body><main><h1 id="prepared">Loading</h1><a href="/prepared?next=1">Next</a><a href="/">Home</a></main></body>`,
    );
    await writeFile(
      path.join(preparedRoot, 'index.ts'),
      `
      export async function load({url,signal}) {
        const response = await fetch('/load-fixture' + url.search, {signal});
        return response.text();
      }
      export function setup({root,data,scope}) {
        root.querySelector('h1').textContent=data;
        scope.add(()=>root.dataset.disposed='true');
      }
    `,
    );
    const manifestPath = path.join(workspace, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.webstir.moduleManifest.views = [
      { name: 'lifecycle-record', path: '/records/:id', page: 'lifecycle' },
    ];
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return workspace;
}

async function startWatchSession(
  workspace: string,
  options: WatchSessionOptions = {},
): Promise<RuntimeSession> {
  const port = await getFreePort();
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'watch',
      '--workspace',
      workspace,
      '--port',
      String(port),
    ],
    cwd: repoRoot,
    env: {
      ...process.env,
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = { text: '' };
  const stderr = { text: '' };
  const stdoutDrain = collectOutput(child.stdout, stdout);
  const stderrDrain = collectOutput(child.stderr, stderr);

  await waitFor(async () => {
    expect(stdout.text).toContain('[webstir] watch starting');
    expect(stdout.text).toContain('[webstir-backend] watch:ready');
    expect(await fetchText(port, '/')).toContain('Home');
    expect(await fetchText(port, '/api')).toContain('API server running');
    await Promise.all(
      (options.readinessChecks ?? []).map(async (check) => {
        expect(await fetchText(port, check.requestPath)).toContain(check.expectedText);
      }),
    );
  }, scaledTimeout(30_000));

  return {
    origin: `http://127.0.0.1:${port}`,
    getLogs() {
      return {
        watchStdout: stdout.text,
        watchStderr: stderr.text,
      };
    },
    async stop() {
      await stopChildProcess(child, [stdoutDrain, stderrDrain], 'watch session');
    },
  };
}

async function startPublishSession(
  workspace: string,
  options: {
    readonly readinessChecks?: readonly {
      requestPath: string;
      expectedText: string;
    }[];
  } = {},
): Promise<RuntimeSession> {
  await materializeRepoLocalWorkspaceDependencies(workspace);
  const publishResult = await runWebstir(['publish', '--workspace', workspace], {
    env: { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' },
  });

  const publishStdout = publishResult.stdout;
  const publishStderr = publishResult.stderr;
  if (publishResult.exitCode !== 0) {
    throw new Error(
      `Publish failed with exit code ${publishResult.exitCode}.\nstdout:\n${publishStdout}\n\nstderr:\n${publishStderr}`,
    );
  }

  const port = await getFreePort();
  const deployChild = Bun.spawn({
    cmd: [
      process.execPath,
      path.join(workspace, 'node_modules', '.bin', 'webstir-backend-deploy'),
      '--workspace',
      workspace,
      '--port',
      String(port),
    ],
    cwd: workspace,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SESSION_SECRET: 'publish-test-session-secret',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const deployStdout = { text: '' };
  const deployStderr = { text: '' };
  const deployStdoutDrain = collectOutput(deployChild.stdout, deployStdout);
  const deployStderrDrain = collectOutput(deployChild.stderr, deployStderr);

  await waitFor(async () => {
    expect(await fetchText(port, '/')).toContain('Home');
    expect(await fetchText(port, '/api')).toContain('API server running');
    await Promise.all(
      (
        options.readinessChecks ?? [
          {
            requestPath: '/api/demo/progressive-enhancement',
            expectedText: 'id="demo-name"',
          },
        ]
      ).map(async (check) => {
        expect(await fetchText(port, check.requestPath)).toContain(check.expectedText);
      }),
    );
  }, scaledTimeout(10_000));

  return {
    origin: `http://127.0.0.1:${port}`,
    getLogs() {
      return {
        publishStdout,
        publishStderr,
        deployStdout: deployStdout.text,
        deployStderr: deployStderr.text,
      };
    },
    async stop() {
      await stopChildProcess(
        deployChild,
        [deployStdoutDrain, deployStderrDrain],
        'publish session',
      );
    },
  };
}

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status ${response.status} for ${requestPath}.`);
  }

  return await response.text();
}

async function requestHtmlDocument(
  origin: string,
  requestPath: string,
  cookie?: string,
): Promise<{
  response: Response;
  html: string;
  cookie: string;
}> {
  const response = await requestWithCookie(origin, requestPath, cookie);
  const html = await response.text();

  return {
    response,
    html,
    cookie: coalesceCookie(response.headers.get('set-cookie'), cookie),
  };
}

async function requestWithCookie(
  origin: string,
  requestPath: string,
  cookie?: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) {
    headers.set('cookie', cookie);
  }

  return await fetch(new URL(requestPath, origin), {
    ...init,
    headers,
  });
}

function extractFormInputValue(html: string, formId: string, name: string): string {
  const formPattern = new RegExp(
    `<form[^>]*id="${escapeRegExp(formId)}"[\\s\\S]*?<input[^>]*name="${escapeRegExp(name)}"[^>]*value="([^"]*)"`,
    'i',
  );
  const match = html.match(formPattern);
  if (!match?.[1]) {
    throw new Error(`Expected input ${name} in form ${formId}.`);
  }

  return decodeHtml(match[1]);
}

function extractFirstEntityId(html: string, entity: 'project' | 'alert'): string {
  const attributeName = entity === 'project' ? 'data-project-id' : 'data-alert-id';
  const match = html.match(new RegExp(`${attributeName}="([^"]+)"`));
  if (!match?.[1]) {
    throw new Error(`Expected at least one ${entity} row.`);
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

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate a free TCP port.');
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  return port;
}

async function waitFor(assertion: () => Promise<void>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(150);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out after ${timeoutMs}ms.`);
}

async function collectOutput(
  stream: ReadableStream<Uint8Array>,
  target: { text: string },
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      target.text += decoder.decode(value, { stream: true });
    }

    target.text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function stopChildProcess(
  child: ReturnType<typeof Bun.spawn>,
  drains: readonly Promise<void>[],
  label: string,
): Promise<void> {
  sendSignal(child.pid, 'SIGTERM');
  const exitedGracefully = await waitForProcessExit(child.pid, scaledTimeout(5_000));
  if (!exitedGracefully) {
    sendSignal(child.pid, 'SIGKILL');
    const exitedForcefully = await waitForProcessExit(child.pid, scaledTimeout(10_000));
    if (!exitedForcefully) {
      throw new Error(`Timed out stopping ${label}.`);
    }
  }

  await Promise.allSettled(drains);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }

    await Bun.sleep(100);
  }

  return !isProcessAlive(pid);
}

async function runWatchBrowserScenarioWithRetry(
  workspace: string,
  scenario: (origin: string, progress?: ScenarioProgress) => Promise<void>,
  options: WatchBrowserScenarioOptions,
): Promise<void> {
  const maxAttempts = process.env.CI ? 2 : 1;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let session: RuntimeSession | undefined;
    const progress: ScenarioProgress = {
      currentStep: 'start watch session',
    };

    try {
      session = await startWatchSession(workspace, {
        readinessChecks: options.readinessChecks,
      });
      await runWithTimeout(
        () => scenario(session.origin, progress),
        scaledTimeout(options.scenarioTimeoutMs),
        `Watch browser scenario timed out during ${progress.currentStep}.`,
        progress,
      );
      return;
    } catch (error) {
      const failure = appendLogs(
        new Error(
          `${error instanceof Error ? error.message : String(error)}${progress.currentStep ? `\nLatest step: ${progress.currentStep}` : ''}`,
        ),
        session?.getLogs() ?? {},
      );
      if (attempt < maxAttempts && isRetryableWatchBrowserError(error)) {
        lastError = failure;
        continue;
      }
      throw failure;
    } finally {
      if (session) {
        await session.stop();
      }
    }
  }

  throw lastError ?? new Error('Watch browser scenario failed without an actionable error.');
}

async function runWithTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
  progress?: ScenarioProgress,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} Latest step: ${progress?.currentStep ?? 'unknown'}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isRetryableWatchBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Watch browser scenario timed out during') ||
    message.includes('Timed out stopping watch session') ||
    message.includes('Timeout') || // Playwright waitForFunction / waitForSelector timeouts
    isTransientBrowserTeardownError(error)
  );
}

function setScenarioStep(progress: ScenarioProgress | undefined, step: string): void {
  if (progress) {
    progress.currentStep = step;
  }
}

function appendLogs(error: unknown, sections: Record<string, string>): Error {
  const message = error instanceof Error ? error.message : String(error);
  const renderedSections = Object.entries(sections)
    .map(([name, value]) => `${name}:\n${tailOutput(value)}`)
    .join('\n\n');

  return new Error(renderedSections ? `${message}\n\n${renderedSections}` : message);
}

function tailOutput(text: string): string {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return '(empty)';
  }

  return normalized.slice(-4_000);
}

async function runPublishBrowserScenarioWithRetry(
  workspace: string,
  scenario: (origin: string, progress?: ScenarioProgress) => Promise<void>,
): Promise<void> {
  const maxAttempts = 2;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let session: RuntimeSession | undefined;
    const progress: ScenarioProgress = {
      currentStep: 'start publish session',
    };

    try {
      session = await startPublishSession(workspace);
      await scenario(session.origin, progress);
      return;
    } catch (error) {
      const failure = appendLogs(
        new Error(
          `${error instanceof Error ? error.message : String(error)}${progress.currentStep ? `\nLatest step: ${progress.currentStep}` : ''}`,
        ),
        session?.getLogs() ?? {},
      );
      if (attempt < maxAttempts && isRetryablePublishBrowserError(error)) {
        lastError = failure;
        continue;
      }
      throw failure;
    } finally {
      if (session) {
        await session.stop();
      }
    }
  }

  throw lastError ?? new Error('Publish browser scenario failed without an actionable error.');
}

function isRetryablePublishBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isTransientBrowserTeardownError(error) ||
    message.includes('Unable to connect') ||
    message.includes('ECONNREFUSED') ||
    message.includes('Navigation timeout')
  );
}

function isTransientBrowserTeardownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Target page, context or browser has been closed') ||
    message.includes('Target crashed') ||
    message.includes('Page crashed') ||
    message.includes('browser has been closed') ||
    message.includes('browser disconnected')
  );
}

function scaledTimeout(timeoutMs: number): number {
  return process.env.CI ? Math.round(timeoutMs * 1.5) : timeoutMs;
}

function sendSignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isMissingProcessError(error)) {
      throw error;
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isMissingProcessError(error)) {
      return false;
    }

    return true;
  }
}

function isMissingProcessError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}

interface RuntimeSession {
  readonly origin: string;
  getLogs(): Record<string, string>;
  stop(): Promise<void>;
}

interface WatchSessionOptions {
  readonly readinessChecks?: readonly WatchReadinessCheck[];
}

interface WatchReadinessCheck {
  readonly requestPath: string;
  readonly expectedText: string;
}

interface WatchBrowserScenarioOptions {
  readonly readinessChecks?: readonly WatchReadinessCheck[];
  readonly scenarioTimeoutMs: number;
}

interface ScenarioProgress {
  currentStep: string;
}
