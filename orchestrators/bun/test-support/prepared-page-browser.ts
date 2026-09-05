import { expect } from 'bun:test';
import type { Browser } from 'playwright';

export async function assertPreparedPage(browser: Browser, origin: string): Promise<void> {
  const page = await browser.newPage();
  try {
    await page.route('**/load-fixture*', (route) => route.fulfill({ body: 'Ready' }));
    await page.goto(`${origin}/prepared`);
    await page.waitForFunction(() => document.querySelector('#prepared')?.textContent === 'Ready');
    const old = await page.locator('main').elementHandle();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/load-fixture?next=1', async (route) => {
      await pending;
      await route.fulfill({ body: 'Next ready' }).catch(() => {});
    });
    const requested = page.waitForRequest('**/load-fixture?next=1');
    await page.locator('a[href="/prepared?next=1"]').click();
    await requested;
    expect(await old!.evaluate((root) => root.isConnected)).toBe(true);
    expect(await page.locator('#prepared').textContent()).toBe('Ready');
    expect(await old!.getAttribute('data-disposed')).toBeNull();
    release();
    await page.waitForFunction(
      () => document.querySelector('#prepared')?.textContent === 'Next ready',
    );
    expect(await old!.getAttribute('data-disposed')).toBe('true');
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#prepared')?.textContent === 'Ready');
    let cancelRelease!: () => void;
    const blocked = new Promise<void>((resolve) => {
      cancelRelease = resolve;
    });
    await page.route('**/load-fixture?next=1', async (route) => {
      await blocked;
      await route.fulfill({ body: 'Obsolete' }).catch(() => {});
    });
    const blockedRequest = page.waitForRequest('**/load-fixture?next=1');
    await page.locator('a[href="/prepared?next=1"]').click();
    await blockedRequest;
    await page.locator('a[href="/"]').click();
    await page.waitForURL(`${origin}/`);
    cancelRelease();
    expect(await page.locator('#prepared').count()).toBe(0);
  } finally {
    await page.close();
  }
}
