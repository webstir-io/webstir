import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { DevServer } from '../src/dev-server.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';

test('browser progressive enhancement flows work in watch mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-progressive-watch-', 'full');
  let session: RuntimeSession | undefined;

  try {
    session = await startWatchSession(workspace);
    await exerciseBrowserScenario(session.origin);
  } catch (error) {
    throw appendLogs(error, session?.getLogs() ?? {});
  } finally {
    if (session) {
      await session.stop();
    }
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

test('browser progressive enhancement flows work in publish mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-progressive-publish-', 'full');

  try {
    await runPublishBrowserScenarioWithRetry(workspace, exerciseBrowserScenario);
  } finally {
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

test('browser auth and CRUD flows work in watch mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-auth-crud-watch-', 'auth-crud');
  let session: RuntimeSession | undefined;

  try {
    session = await startWatchSession(workspace);
    await exerciseAuthCrudBrowserScenario(session.origin);
  } catch (error) {
    throw appendLogs(error, session?.getLogs() ?? {});
  } finally {
    if (session) {
      await session.stop();
    }
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

test('browser auth and CRUD flows work in publish mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-auth-crud-publish-', 'auth-crud');
  let session: RuntimeSession | undefined;

  try {
    session = await startPublishSession(workspace);
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
          expectedText: 'id="dashboard-team"'
        }
      ],
      scenarioTimeoutMs: 45_000
    });
  } finally {
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 150_000);

test('browser dashboard flows work in publish mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-dashboard-publish-', 'dashboard');
  let session: RuntimeSession | undefined;

  try {
    session = await startPublishSession(workspace);
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

async function exerciseBrowserScenario(origin: string): Promise<void> {
  const browser = await launchBrowser();
  try {
    const fragmentContext = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 }
    });
    const fragmentPage = await fragmentContext.newPage();

    try {
      await fragmentPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await fragmentPage.locator('a[href="/api/demo/progressive-enhancement"]').click({ noWaitAfter: true });
      await waitForPathname(fragmentPage, '/api/demo/progressive-enhancement');
      await fragmentPage.locator('h1').waitFor({ state: 'visible' });

      await assertDocumentNavigationResetsScroll(fragmentPage, origin);
      await assertFragmentUpdateAndFocus(fragmentPage);
    } finally {
      await fragmentContext.close().catch(() => undefined);
    }

    const sessionContext = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 }
    });
    const sessionPage = await sessionContext.newPage();

    try {
      await sessionPage.goto(`${origin}/api/demo/progressive-enhancement`, { waitUntil: 'domcontentloaded' });
      await sessionPage.locator('#session-name').waitFor({ state: 'visible' });
      await assertSessionFlow(sessionPage);
    } finally {
      await sessionContext.close().catch(() => undefined);
    }

    const baselineContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 }
    });
    const baselinePage = await baselineContext.newPage();

    try {
      await assertNativeRedirectFlow(baselinePage, origin);
    } finally {
      await baselineContext.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function assertDocumentNavigationResetsScroll(page: Page, origin: string): Promise<void> {
  await page.evaluate(() => {
    const state = window as typeof window & {
      __webstirScrollCalls?: unknown[][];
      __webstirOriginalScrollTo?: typeof window.scrollTo;
    };

    state.__webstirScrollCalls = [];
    if (!state.__webstirOriginalScrollTo) {
      state.__webstirOriginalScrollTo = window.scrollTo.bind(window);
      window.scrollTo = ((...args: unknown[]) => {
        state.__webstirScrollCalls?.push(args);
        return state.__webstirOriginalScrollTo?.(...(args as Parameters<typeof window.scrollTo>));
      }) as typeof window.scrollTo;
    }
  });

  await page.locator('a[href="/"]').click({ noWaitAfter: true });
  await waitForPathname(page, '/');
  await page.locator('h1').waitFor({ state: 'visible' });
  const scrollCalls = await page.evaluate(() => {
    const state = window as typeof window & { __webstirScrollCalls?: unknown[][] };
    return state.__webstirScrollCalls ?? [];
  });

  expect(await page.locator('h1').textContent()).toBe('Home');
  expect(scrollCalls.length).toBeGreaterThan(0);

  const lastCall = scrollCalls.at(-1)?.[0];
  if (typeof lastCall === 'number') {
    expect(lastCall).toBe(0);
  } else {
    expect(lastCall).toEqual(expect.objectContaining({ top: 0 }));
  }

  await page.locator('a[href="/api/demo/progressive-enhancement"]').click({ noWaitAfter: true });
  await waitForPathname(page, '/api/demo/progressive-enhancement');
  await page.locator('#demo-name').waitFor({ state: 'visible' });
}

async function assertFragmentUpdateAndFocus(page: Page): Promise<void> {
  await page.locator('#demo-name').fill('Enhanced Browser');

  await page.locator('#demo-update-greeting').click();
  await page.waitForFunction(
    () => document.querySelector('#greeting-preview h2')?.textContent === 'Hello, Enhanced Browser'
  );
  await page.waitForFunction(() => document.activeElement?.id === 'greeting-update-focus');

  expect(new URL(page.url()).pathname).toBe('/api/demo/progressive-enhancement');
  expect(await page.locator('#greeting-preview').textContent()).toContain('replace just this region');
}

async function assertSessionFlow(page: Page): Promise<void> {
  await page.locator('#session-name').fill('Casey Browser');

  await page.locator('#demo-sign-in').click();
  await page.waitForFunction(
    () => document.querySelector('#session-user')?.textContent?.trim() === 'Casey Browser'
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#session-user').waitFor({ state: 'visible' });
  expect(await page.locator('#session-user').textContent()).toBe('Casey Browser');

  await page.locator('#demo-sign-out').click();
  await page.locator('#demo-sign-in').waitFor({ state: 'visible' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#demo-sign-in').waitFor({ state: 'visible' });
  expect(await page.locator('#session-status').textContent()).toContain('Not signed in');
}

async function assertNativeRedirectFlow(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/api/demo/progressive-enhancement`, { waitUntil: 'domcontentloaded' });
  await page.locator('#demo-name').fill('Native Browser');

  await page.locator('#greeting-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await page.waitForFunction(() =>
    window.location.pathname === '/api/demo/progressive-enhancement'
    && window.location.search === '?source=redirect&name=Native%20Browser'
  );

  await page.locator('#greeting-preview').waitFor({ state: 'visible' });
  expect(await page.locator('#greeting-preview').textContent()).toContain('Hello, Native Browser');
  expect(await page.locator('body').textContent()).toContain('Last submit used the no-JavaScript redirect path.');
}

async function exerciseAuthCrudBrowserScenario(origin: string): Promise<void> {
  const browser = await launchBrowser();
  try {
    const enhancedContext = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 }
    });
    const enhancedPage = await enhancedContext.newPage();

    try {
      await enhancedPage.goto(`${origin}/api/demo/auth-crud`, { waitUntil: 'domcontentloaded' });
      await enhancedPage.locator('#auth-email').waitFor({ state: 'visible' });

      await enhancedPage.locator('#auth-email').fill('casey.browser@example.com');
      await enhancedPage.locator('#auth-sign-in').click();
      await enhancedPage.waitForFunction(
        () => document.querySelector('#session-user')?.textContent?.includes('casey.browser@example.com') ?? false
      );

      await enhancedPage.locator('#project-title').fill('');
      await enhancedPage.locator('#project-notes').fill('This should fail first.');
      await enhancedPage.locator('#project-create-submit').click();
      await enhancedPage.locator('text=Project title is required.').waitFor({ state: 'visible' });

      await enhancedPage.locator('#project-title').fill('Browser launch checklist');
      await enhancedPage.locator('#project-status').selectOption('active');
      await enhancedPage.locator('#project-notes').fill('Created through the enhanced fragment path.');
      await enhancedPage.locator('#project-create-submit').click();
      await enhancedPage.waitForFunction(
        () => document.body.textContent?.includes('Created project "Browser launch checklist".') ?? false
      );

      const projectRow = enhancedPage.locator('[data-project-row="true"]').first();
      const projectId = await projectRow.getAttribute('data-project-id');
      if (!projectId) {
        throw new Error('Expected a created project row.');
      }

      await projectRow.locator('input[name="title"]').fill('Browser launch checklist updated');
      await projectRow.locator('textarea[name="notes"]').fill('Updated through the enhanced fragment path.');
      await enhancedPage.locator(`#project-edit-form-${projectId}`).evaluate((form: HTMLFormElement) => form.requestSubmit());
      await enhancedPage.waitForFunction(
        (id) => document.querySelector(`[data-project-id="${id}"] h4`)?.textContent === 'Browser launch checklist updated',
        projectId
      );

      await enhancedPage.reload({ waitUntil: 'domcontentloaded' });
      await enhancedPage.locator(`[data-project-id="${projectId}"]`).waitFor({ state: 'visible' });
      expect(await enhancedPage.locator(`[data-project-id="${projectId}"] h4`).textContent()).toBe('Browser launch checklist updated');

      await enhancedPage.locator(`#project-delete-form-${projectId}`).evaluate((form: HTMLFormElement) => form.requestSubmit());
      await enhancedPage.waitForFunction(
        (id) => !document.querySelector(`[data-project-id="${id}"]`),
        projectId
      );
      expect(await enhancedPage.locator('#flash-region').textContent()).toContain('Deleted project "Browser launch checklist updated".');
    } finally {
      await enhancedContext.close().catch(() => undefined);
    }

    const baselineContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 }
    });
    const baselinePage = await baselineContext.newPage();

    try {
      await baselinePage.goto(`${origin}/api/demo/auth-crud`, { waitUntil: 'domcontentloaded' });
      await baselinePage.locator('#project-title').fill('Native blocked project');
      await baselinePage.locator('#project-notes').fill('Expect an auth redirect.');
      await baselinePage.locator('#project-create-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(() =>
        window.location.pathname === '/api/demo/auth-crud'
        && document.body.textContent?.includes('Sign in required to manage projects.')
      );
      expect(new URL(baselinePage.url()).pathname).toBe('/api/demo/auth-crud');
      expect(await baselinePage.locator('body').textContent()).toContain('Sign in required to manage projects.');

      await baselinePage.locator('#auth-email').fill('native@example.com');
      await baselinePage.locator('#auth-sign-in-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(() =>
        window.location.pathname === '/api/demo/auth-crud'
        && document.body.textContent?.includes('Signed in as native@example.com.')
      );
      expect(new URL(baselinePage.url()).pathname).toBe('/api/demo/auth-crud');
      expect(await baselinePage.locator('body').textContent()).toContain('Signed in as native@example.com.');

      await baselinePage.locator('#project-title').fill('Native create project');
      await baselinePage.locator('#project-status').selectOption('active');
      await baselinePage.locator('#project-notes').fill('Created through the no-JavaScript redirect path.');
      await baselinePage.locator('#project-create-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(() =>
        window.location.pathname === '/api/demo/auth-crud'
        && document.body.textContent?.includes('Created project "Native create project".')
      );
      expect(new URL(baselinePage.url()).pathname).toBe('/api/demo/auth-crud');
      expect(await baselinePage.locator('body').textContent()).toContain('Created project "Native create project".');

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
  const signInResponse = await requestWithCookie(origin, '/api/demo/auth-crud/session/sign-in', initial.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: `_csrf=${encodeURIComponent(signInCsrf)}&email=${encodeURIComponent('casey.browser@example.com')}`,
    redirect: 'manual'
  });

  expect(signInResponse.status).toBe(303);
  expect(signInResponse.headers.get('location')).toBe('/api/demo/auth-crud');

  const signedInCookie = coalesceCookie(signInResponse.headers.get('set-cookie'), initial.cookie);
  const signedIn = await requestHtmlDocument(origin, '/api/demo/auth-crud', signedInCookie);
  expect(signedIn.html).toContain('Signed in as <strong>casey.browser@example.com</strong>.');

  const invalidCreateCsrf = extractFormInputValue(signedIn.html, 'project-create-form', '_csrf');
  const invalidCreateResponse = await requestWithCookie(origin, '/api/demo/auth-crud/projects/create', signedIn.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(invalidCreateCsrf)}&title=&status=active&notes=${encodeURIComponent('This should fail first.')}`
  });
  const invalidCreateHtml = await invalidCreateResponse.text();

  expect(invalidCreateResponse.status).toBe(422);
  expect(invalidCreateResponse.headers.get('x-webstir-fragment-target')).toBe('backoffice-shell');
  expect(invalidCreateHtml).toContain('Project title is required.');

  const createCsrf = extractFormInputValue(signedIn.html, 'project-create-form', '_csrf');
  const createResponse = await requestWithCookie(origin, '/api/demo/auth-crud/projects/create', signedIn.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: [
      `_csrf=${encodeURIComponent(createCsrf)}`,
      `title=${encodeURIComponent('Browser launch checklist')}`,
      'status=active',
      `notes=${encodeURIComponent('Created through the publish redirect path.')}`
    ].join('&'),
    redirect: 'manual'
  });

  expect(createResponse.status).toBe(303);
  expect(createResponse.headers.get('location')).toBe('/api/demo/auth-crud');

  const afterCreate = await requestHtmlDocument(origin, '/api/demo/auth-crud', signedIn.cookie);
  expect(afterCreate.html).toContain('Created project &quot;Browser launch checklist&quot;.');
  expect(afterCreate.html).toContain('Browser launch checklist');

  const projectId = extractFirstEntityId(afterCreate.html, 'project');
  const updateCsrf = extractFormInputValue(afterCreate.html, `project-edit-form-${projectId}`, '_csrf');
  const updateResponse = await requestWithCookie(origin, '/api/demo/auth-crud/projects/update', signedIn.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: [
      `_csrf=${encodeURIComponent(updateCsrf)}`,
      `projectId=${encodeURIComponent(projectId)}`,
      `title=${encodeURIComponent('Operations cleanup updated')}`,
      'status=archived',
      `notes=${encodeURIComponent('Persist this edit across the next document request.')}`
    ].join('&')
  });
  const updateHtml = await updateResponse.text();

  expect(updateResponse.status).toBe(200);
  expect(updateResponse.headers.get('x-webstir-fragment-target')).toBe('backoffice-shell');
  expect(updateHtml).toContain('Operations cleanup updated');

  const afterUpdate = await requestHtmlDocument(origin, '/api/demo/auth-crud', signedIn.cookie);
  expect(afterUpdate.html).toContain('Operations cleanup updated');

  const deleteCsrf = extractFormInputValue(afterUpdate.html, `project-delete-form-${projectId}`, '_csrf');
  const deleteResponse = await requestWithCookie(origin, '/api/demo/auth-crud/projects/delete', signedIn.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(deleteCsrf)}&projectId=${encodeURIComponent(projectId)}`
  });
  const deleteHtml = await deleteResponse.text();

  expect(deleteResponse.status).toBe(200);
  expect(deleteResponse.headers.get('x-webstir-fragment-target')).toBe('backoffice-shell');
  expect(deleteHtml.includes(`project-edit-form-${projectId}`)).toBe(false);

  const afterDelete = await requestHtmlDocument(origin, '/api/demo/auth-crud', signedIn.cookie);
  expect(afterDelete.html.includes(`project-edit-form-${projectId}`)).toBe(false);
}

async function exerciseDashboardBrowserScenario(origin: string, progress?: ScenarioProgress): Promise<void> {
  const browser = await launchBrowser();
  try {
    const enhancedContext = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 }
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
        () => document.querySelector('#dashboard-heading')?.textContent === 'Dashboard focus: Growth · last 30 days'
      );

      setScenarioStep(progress, 'refresh enhanced dashboard metrics');
      const enhancedRefreshCount = await readRefreshCount(enhancedPage);
      await enhancedPage.locator('#metrics-refresh').click();
      await enhancedPage.waitForFunction(
        (previousCount) => {
          const text = document.querySelector('#metrics-refresh-count')?.textContent ?? '';
          const match = text.match(/Refresh count: (\d+)/);
          return match ? Number(match[1]) > previousCount : false;
        },
        enhancedRefreshCount
      );

      const alertRow = enhancedPage.locator('[data-alert-row="true"]').first();
      const alertId = await alertRow.getAttribute('data-alert-id');
      if (!alertId) {
        throw new Error('Expected an alert row in the dashboard proof app.');
      }

      setScenarioStep(progress, 'acknowledge enhanced dashboard alert');
      await enhancedPage.locator(`#acknowledge-alert-${alertId}`).click();
      await enhancedPage.waitForFunction(
        (id) => !document.querySelector(`[data-alert-id="${id}"]`),
        alertId
      );
      expect(await enhancedPage.locator('#alerts-status').textContent()).toContain('Acknowledged');

      setScenarioStep(progress, 'reload enhanced dashboard page');
      await enhancedPage.reload({ waitUntil: 'domcontentloaded' });
      await enhancedPage.locator('#dashboard-heading').waitFor({ state: 'visible' });
      expect(await enhancedPage.locator('#dashboard-heading').textContent()).toBe('Dashboard focus: Growth · last 30 days');
      expect(await readRefreshCount(enhancedPage)).toBeGreaterThan(enhancedRefreshCount);
      expect(await enhancedPage.locator(`[data-alert-id="${alertId}"]`).count()).toBe(0);
    } finally {
      await enhancedContext.close().catch(() => undefined);
    }

    const baselineContext = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 1280, height: 720 }
    });
    const baselinePage = await baselineContext.newPage();

    try {
      setScenarioStep(progress, 'load baseline dashboard page');
      await baselinePage.goto(`${origin}/api/demo/dashboard`, { waitUntil: 'domcontentloaded' });
      setScenarioStep(progress, 'submit baseline dashboard filters');
      await baselinePage.locator('#dashboard-team').selectOption('north');
      await baselinePage.locator('#dashboard-range').selectOption('today');
      await baselinePage.locator('#dashboard-filter-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(() =>
        window.location.pathname === '/api/demo/dashboard'
        && document.body.textContent?.includes('Filtered to North region for today.')
      );

      setScenarioStep(progress, 'refresh baseline dashboard metrics');
      const baselineRefreshCount = await readRefreshCount(baselinePage);
      await baselinePage.locator('#metrics-refresh-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      await baselinePage.waitForFunction(() =>
        window.location.pathname === '/api/demo/dashboard'
        && document.body.textContent?.includes('Snapshot refreshed 1 time for North region.')
      );

      expect(await baselinePage.locator('#dashboard-heading').textContent()).toBe('Dashboard focus: North region · today');
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
  const nativeFilterResponse = await requestWithCookie(origin, '/api/demo/dashboard/context', initial.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: `_csrf=${encodeURIComponent(nativeFilterCsrf)}&team=growth&range=month`,
    redirect: 'manual'
  });

  expect(nativeFilterResponse.status).toBe(303);
  expect(nativeFilterResponse.headers.get('location')).toBe('/api/demo/dashboard');

  const filtered = await requestHtmlDocument(origin, '/api/demo/dashboard', initial.cookie);
  expect(filtered.html).toContain('Dashboard focus: Growth · last 30 days');
  expect(filtered.html).toContain('Filtered to Growth for last 30 days.');

  const enhancedFilterCsrf = extractFormInputValue(filtered.html, 'dashboard-filter-form', '_csrf');
  const enhancedFilterResponse = await requestWithCookie(origin, '/api/demo/dashboard/context', filtered.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(enhancedFilterCsrf)}&team=north&range=today`
  });
  const enhancedFilterHtml = await enhancedFilterResponse.text();

  expect(enhancedFilterResponse.status).toBe(200);
  expect(enhancedFilterResponse.headers.get('x-webstir-fragment-target')).toBe('dashboard-shell');
  expect(enhancedFilterHtml).toContain('Dashboard focus: North region · today');

  const refreshCsrf = extractFormInputValue(filtered.html, 'metrics-refresh-form', '_csrf');
  const refreshResponse = await requestWithCookie(origin, '/api/demo/dashboard/metrics/refresh', filtered.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(refreshCsrf)}`
  });
  const refreshHtml = await refreshResponse.text();

  expect(refreshResponse.status).toBe(200);
  expect(refreshResponse.headers.get('x-webstir-fragment-target')).toBe('metrics-panel');
  expect(refreshHtml).toContain('Refresh count: 1');

  const refreshed = await requestHtmlDocument(origin, '/api/demo/dashboard', filtered.cookie);
  expect(refreshed.html).toContain('Refresh count: 1');

  const alertId = extractFirstEntityId(refreshed.html, 'alert');
  const acknowledgeCsrf = extractFormInputValue(refreshed.html, `acknowledge-alert-form-${alertId}`, '_csrf');
  const acknowledgeResponse = await requestWithCookie(origin, '/api/demo/dashboard/alerts/acknowledge', filtered.cookie, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-webstir-client-nav': '1'
    },
    body: `_csrf=${encodeURIComponent(acknowledgeCsrf)}&alertId=${encodeURIComponent(alertId)}`
  });
  const acknowledgeHtml = await acknowledgeResponse.text();

  expect(acknowledgeResponse.status).toBe(200);
  expect(acknowledgeResponse.headers.get('x-webstir-fragment-target')).toBe('alerts-panel');
  expect(acknowledgeHtml.includes(`data-alert-id="${alertId}"`)).toBe(false);

  const afterAcknowledge = await requestHtmlDocument(origin, '/api/demo/dashboard', filtered.cookie);
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
    pathname
  );
}

async function launchBrowser(): Promise<Browser> {
  return await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage']
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
    rm(path.join(workspace, 'node_modules'), { recursive: true, force: true })
  ]);
  return workspace;
}

async function startWatchSession(
  workspace: string,
  options: WatchSessionOptions = {}
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
      String(port)
    ],
    cwd: repoRoot,
    env: {
      ...process.env,
      WEBSTIR_BACKEND_TYPECHECK: 'skip'
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const stdout = { text: '' };
  const stderr = { text: '' };
  const stdoutDrain = collectOutput(child.stdout, stdout);
  const stderrDrain = collectOutput(child.stderr, stderr);

  await waitFor(async () => {
    expect(stdout.text).toContain('[webstir] watch starting');
    expect(stdout.text).toContain('[webstir] backend ready at');
    expect(await fetchText(port, '/')).toContain('Home');
    expect(await fetchText(port, '/api')).toContain('API server running');
    await Promise.all(
      (options.readinessChecks ?? []).map(async (check) => {
        expect(await fetchText(port, check.requestPath)).toContain(check.expectedText);
      })
    );
  }, 30_000);

  return {
    origin: `http://127.0.0.1:${port}`,
    getLogs() {
      return {
        watchStdout: stdout.text,
        watchStderr: stderr.text
      };
    },
    async stop() {
      await stopChildProcess(child, [stdoutDrain, stderrDrain], 'watch session');
    }
  };
}

async function startPublishSession(workspace: string): Promise<RuntimeSession> {
  const publishResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'publish',
      '--workspace',
      workspace
    ],
    cwd: repoRoot,
    env: {
      ...process.env,
      WEBSTIR_BACKEND_TYPECHECK: 'skip'
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const publishStdout = decodeOutput(publishResult.stdout);
  const publishStderr = decodeOutput(publishResult.stderr);
  if (publishResult.exitCode !== 0) {
    throw new Error(
      `Publish failed with exit code ${publishResult.exitCode}.\nstdout:\n${publishStdout}\n\nstderr:\n${publishStderr}`
    );
  }

  const backendPort = await getFreePort();
  const backendChild = Bun.spawn({
    cmd: [process.execPath, path.join(workspace, 'build', 'backend', 'index.js')],
    cwd: workspace,
    env: {
      ...process.env,
      PORT: String(backendPort),
      NODE_ENV: 'test'
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const backendStdout = { text: '' };
  const backendStderr = { text: '' };
  const backendStdoutDrain = collectOutput(backendChild.stdout, backendStdout);
  const backendStderrDrain = collectOutput(backendChild.stderr, backendStderr);

  await waitFor(async () => {
    expect(backendStdout.text).toContain('API server running at');
  }, 20_000);

  const port = await getFreePort();
  const server = new DevServer({
    buildRoot: path.join(workspace, 'dist', 'frontend'),
    host: '127.0.0.1',
    port,
    apiProxyOrigin: `http://127.0.0.1:${backendPort}`
  });
  await server.start();

  await waitFor(async () => {
    expect(await fetchText(port, '/')).toContain('Home');
    expect(await fetchText(port, '/api')).toContain('API server running');
  }, 10_000);

  return {
    origin: `http://127.0.0.1:${port}`,
    getLogs() {
      return {
        publishStdout,
        publishStderr,
        backendStdout: backendStdout.text,
        backendStderr: backendStderr.text
      };
    },
    async stop() {
      await server.stop();
      await stopChildProcess(backendChild, [backendStdoutDrain, backendStderrDrain], 'publish backend session');
    }
  };
}

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status ${response.status} for ${requestPath}.`);
  }

  return await response.text();
}

async function requestHtmlDocument(origin: string, requestPath: string, cookie?: string): Promise<{
  response: Response;
  html: string;
  cookie: string;
}> {
  const response = await requestWithCookie(origin, requestPath, cookie);
  const html = await response.text();

  return {
    response,
    html,
    cookie: coalesceCookie(response.headers.get('set-cookie'), cookie)
  };
}

async function requestWithCookie(
  origin: string,
  requestPath: string,
  cookie?: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookie) {
    headers.set('cookie', cookie);
  }

  return await fetch(new URL(requestPath, origin), {
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

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out after ${timeoutMs}ms.`);
}

async function collectOutput(
  stream: ReadableStream<Uint8Array>,
  target: { text: string }
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
  label: string
): Promise<void> {
  child.kill('SIGTERM');
  const exitedGracefully = await waitForProcessExit(child, 5_000);
  if (!exitedGracefully) {
    child.kill('SIGKILL');
    const exitedForcefully = await waitForProcessExit(child, 5_000);
    if (!exitedForcefully) {
      throw new Error(`Timed out stopping ${label}.`);
    }
  }

  await Promise.allSettled(drains);
}

async function waitForProcessExit(child: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<boolean> {
  const outcome = await Promise.race([
    child.exited.then(() => 'exited' as const).catch(() => 'exited' as const),
    Bun.sleep(timeoutMs).then(() => 'timeout' as const)
  ]);
  return outcome === 'exited';
}

async function runWatchBrowserScenarioWithRetry(
  workspace: string,
  scenario: (origin: string, progress?: ScenarioProgress) => Promise<void>,
  options: WatchBrowserScenarioOptions
): Promise<void> {
  const maxAttempts = process.env.CI ? 2 : 1;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let session: RuntimeSession | undefined;
    const progress: ScenarioProgress = {
      currentStep: 'start watch session'
    };

    try {
      session = await startWatchSession(workspace, {
        readinessChecks: options.readinessChecks
      });
      await runWithTimeout(
        () => scenario(session.origin, progress),
        options.scenarioTimeoutMs,
        `Watch browser scenario timed out during ${progress.currentStep}.`,
        progress
      );
      return;
    } catch (error) {
      const failure = appendLogs(error, session?.getLogs() ?? {});
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
  progress?: ScenarioProgress
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} Latest step: ${progress?.currentStep ?? 'unknown'}`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function isRetryableWatchBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Watch browser scenario timed out during')
    || message.includes('Timed out stopping watch session')
    || isTransientBrowserTeardownError(error);
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
  scenario: (origin: string) => Promise<void>
): Promise<void> {
  const maxAttempts = process.env.CI ? 2 : 1;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let session: RuntimeSession | undefined;

    try {
      session = await startPublishSession(workspace);
      await scenario(session.origin);
      return;
    } catch (error) {
      const failure = appendLogs(error, session?.getLogs() ?? {});
      if (attempt < maxAttempts && isTransientBrowserTeardownError(error)) {
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

function isTransientBrowserTeardownError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Target page, context or browser has been closed')
    || message.includes('Target crashed')
    || message.includes('Page crashed')
    || message.includes('browser has been closed')
    || message.includes('browser disconnected');
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
