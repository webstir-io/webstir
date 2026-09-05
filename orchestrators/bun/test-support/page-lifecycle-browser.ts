import { expect } from 'bun:test';
import type { Browser } from 'playwright';

type VisitWindow = Window & { visits: { path: string; setup?: string }[] };

export async function assertPageLifecycle(browser: Browser, origin: string): Promise<void> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      (window as unknown as VisitWindow).visits = [];
      window.addEventListener('webstir:client-nav', () => {
        const root = document.querySelector('main');
        (window as unknown as VisitWindow).visits.push({
          path: location.pathname,
          setup: root?.dataset.visit,
        });
      });
    });
    await page.goto(`${origin}/lifecycle`);
    await page.waitForFunction(() => document.querySelector('main')?.dataset.visit === '');
    await page.locator('#counter').click();
    expect(await page.locator('#counter').textContent()).toBe('Count: 1');
    await page.evaluate(() => {
      const anchor = document.createElement('a');
      anchor.href = '#counter';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    });
    await page.waitForURL('**/lifecycle#counter');
    await page.goBack();
    await page.waitForURL(`${origin}/lifecycle`);
    expect(await page.locator('#counter').textContent()).toBe('Count: 1');
    expect(await page.evaluate(() => (window as unknown as VisitWindow).visits)).toEqual([]);
    const old = await page.locator('main').elementHandle();
    if (!old) throw new Error('Missing initial main');
    await page.locator('a[href="/lifecycle?visit=next"]').click();
    await page.waitForFunction(
      () => document.querySelector('main')?.dataset.visit === '?visit=next',
    );
    expect(await old.getAttribute('data-disposed')).toBe('true');
    expect(await page.locator('#counter').textContent()).toBe('Count: 0');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('main')?.dataset.visit === '');
    await page.goForward();
    await page.waitForFunction(
      () => document.querySelector('main')?.dataset.visit === '?visit=next',
    );

    // Keep an outgoing root to detect leaked observers, listeners, and timer work.
    const outgoing = await page.locator('main').elementHandle();
    if (!outgoing) throw new Error('Missing outgoing main');
    await page.locator('a[href="/"]').click();
    await page.waitForURL(`${origin}/`);
    expect(await outgoing.getAttribute('data-disposed')).toBe('true');
    const ticks = await outgoing.getAttribute('data-ticks');
    const observations = await outgoing.getAttribute('data-observations');
    const activity = await outgoing.evaluate((root) => root.querySelector('output')?.textContent);
    await outgoing.evaluate((root) => {
      const button = root.querySelector('button');
      if (!button) throw new Error('Missing counter');
      button.textContent = 'Detached';
      button.click();
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForTimeout(450);
    expect(await outgoing.getAttribute('data-ticks')).toBe(ticks);
    expect(await outgoing.getAttribute('data-observations')).toBe(observations);
    expect(await outgoing.evaluate((root) => root.querySelector('output')?.textContent)).toBe(
      activity,
    );
    expect(await outgoing.evaluate((root) => root.querySelector('button')?.textContent)).toBe(
      'Detached',
    );

    for (let visit = 0; visit < 2; visit++) {
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = '/lifecycle';
        document.body.append(link);
        link.click();
        link.remove();
      });
      await page.waitForFunction(() => document.querySelector('main')?.dataset.visit === '');
      await page.locator('#counter').click();
      expect(await page.locator('#counter').textContent()).toBe('Count: 1');
      await page.locator('a[href="/"]').click();
      await page.waitForURL(`${origin}/`);
    }
    // Hold only the application's request; the navigation document still loads.
    let releaseRequest: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route('**/lifecycle?pending=1', async (route) => {
      if (route.request().headers()['x-webstir-client-nav']) {
        await route.continue();
      } else {
        await held;
        await route.fulfill({ body: 'done' }).catch(() => {});
      }
    });
    try {
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = '/lifecycle?pending=1';
        document.body.append(link);
        link.click();
        link.remove();
      });
      await page.waitForFunction(
        () => document.querySelector('main')?.dataset.visit === '?pending=1',
      );
      const failed = page.waitForEvent('requestfailed', {
        predicate: (request) => request.url().endsWith('/lifecycle?pending=1'),
      });
      await page.locator('a[href="/"]').click();
      await page.waitForURL(`${origin}/`);
      await failed;
    } finally {
      releaseRequest?.();
      await page.unroute('**/lifecycle?pending=1');
    }
    const visits = await page.evaluate(() => (window as unknown as VisitWindow).visits);
    expect(visits.filter((visit) => visit.path === '/lifecycle').length).toBe(6);
    expect(
      visits
        .filter((visit) => visit.path === '/lifecycle')
        .every((visit) => typeof visit.setup === 'string'),
    ).toBe(true);
    for (const path of ['/records/one', '/records/two']) {
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.href = href;
        document.body.append(link);
        link.click();
        link.remove();
      }, path);
      await page.waitForFunction(
        (expected) => document.querySelector('main')?.dataset.path === expected,
        path,
      );
      expect(await page.locator('#counter').textContent()).toBe('Count: 0');
      await page.locator('#counter').click();
    }
    await page.route('**/script-order', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<head><title>Scripts</title><script src="/head-order.js"></script></head><main id="script-root"><script type="module" src="/body-order.js"></script></main>',
      }),
    );
    await page.route('**/head-order.js', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: 'document.querySelector("#script-root").dataset.head = "ready";',
      }),
    );
    await page.route('**/body-order.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      await route.fulfill({
        contentType: 'text/javascript',
        body: 'document.querySelector("#script-root").dataset.body = "ready";',
      });
    });
    await page.evaluate(() => {
      window.addEventListener('webstir:client-nav', () => {
        const root = document.querySelector<HTMLElement>('#script-root');
        if (root)
          root.dataset.eventReady = String(
            root.dataset.head === 'ready' && root.dataset.body === 'ready',
          );
      });
      const link = document.createElement('a');
      link.href = '/script-order';
      document.body.append(link);
      link.click();
      link.remove();
    });
    await page.waitForFunction(
      () => document.querySelector<HTMLElement>('#script-root')?.dataset.eventReady === 'true',
    );
    await page.route('**/slow-script-page', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<main><a id="leave-slow-script" href="/records/after-slow-script">Leave</a><script src="/never-ready.js"></script></main>',
      }),
    );
    let releaseScript: (() => void) | undefined;
    const heldScript = new Promise<void>((resolve) => {
      releaseScript = resolve;
    });
    await page.route('**/never-ready.js', async (route) => {
      await heldScript;
      await route.fulfill({ contentType: 'text/javascript', body: '' }).catch(() => {});
    });
    try {
      const requested = page.waitForRequest('**/never-ready.js');
      await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = '/slow-script-page';
        document.body.append(link);
        link.click();
        link.remove();
      });
      await requested;
      await page.locator('#leave-slow-script').click();
      await page.waitForFunction(
        () => document.querySelector('main')?.dataset.path === '/records/after-slow-script',
        undefined,
        { timeout: 5000 },
      );
    } finally {
      releaseScript?.();
      await page.unroute('**/never-ready.js');
    }
    let authDocumentNavigation = false;
    page.on('request', (request) => {
      if (request.url().endsWith('/signed-out') && request.isNavigationRequest())
        authDocumentNavigation = true;
    });
    await page.route('**/auth-redirect', (route) =>
      route.fulfill({ status: 302, headers: { location: '/signed-out' } }),
    );
    await page.route('**/signed-out', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<main id="signed-out">Sign in</main>' }),
    );
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/auth-redirect';
      document.body.append(link);
      link.click();
    });
    await page.locator('#signed-out').waitFor();
    expect(authDocumentNavigation).toBe(true);
    expect(errors).toEqual([]);
  } catch (error) {
    throw new Error(
      `${String(error)}\nURL: ${page.url()}\nErrors: ${errors.join('; ')}\n${await page.content()}`,
    );
  } finally {
    await page.close();
  }
}
