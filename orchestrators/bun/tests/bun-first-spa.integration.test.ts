import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';

import { packageRoot, repoRoot } from '../src/paths.ts';
import {
  appendWatchLogs,
  collectOutput,
  getFreePort,
  removeTrackedChild,
  stopTrackedChildren,
  waitFor,
} from '../test-support/watch.ts';

const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
});

test('Bun-first SPA watch uses Bun dev serving and hot-applies JavaScript edits', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'spa');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(workspace, port);

  let browser: Browser | undefined;
  let originalScript = '';

  try {
    await waitFor(async () => {
      const html = await fetchText(port, '/');
      expect(html).toContain('data-bun-dev-server-script');
      expect(html).toContain('Home');
    }, 30_000);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      (window as Window & { __bunFirstMarker?: string }).__bunFirstMarker = 'persist';
    });

    const scriptPath = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.ts');
    originalScript = await readFile(scriptPath, 'utf8');
    await writeFile(
      scriptPath,
      originalScript.replace(
        "const homeMessage = 'Home';",
        "const homeMessage = 'Hot Bun Home';"
      ),
      'utf8'
    );

    await page.waitForFunction(() => {
      const main = document.querySelector('main');
      return main?.textContent?.includes('Hot Bun Home') && main instanceof HTMLElement && main.dataset.hmrRendered === '1';
    });

    await context.close();
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    if (browser) {
      await browser.close();
    }
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
    if (originalScript) {
      await writeFile(path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.ts'), originalScript, 'utf8');
    }
  }
}, 120_000);

test('Bun-first SPA watch hot-applies CSS edits without a full page reload', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'spa');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(workspace, port);

  let browser: Browser | undefined;
  let originalStylesheet = '';

  try {
    await waitFor(async () => {
      const html = await fetchText(port, '/');
      expect(html).toContain('data-bun-dev-server-script');
      expect(html).toContain('Home');
    }, 30_000);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor({ state: 'visible' });
    const stylesheetPath = path.join(workspace, 'src', 'frontend', 'app', 'app.css');
    originalStylesheet = await readFile(stylesheetPath, 'utf8');
    await writeFile(
      stylesheetPath,
      `${originalStylesheet}\nbody { background: rgb(255, 0, 0); }\n`,
      'utf8'
    );

    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(255, 0, 0)');

    await context.close();
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    if (browser) {
      await browser.close();
    }
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
    if (originalStylesheet) {
      await writeFile(path.join(workspace, 'src', 'frontend', 'app', 'app.css'), originalStylesheet, 'utf8');
    }
  }
}, 120_000);

test('Bun-first SPA watch applies page CSS edits', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'spa');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(workspace, port);

  let browser: Browser | undefined;
  let originalStylesheet = '';

  try {
    await waitFor(async () => {
      const html = await fetchText(port, '/');
      expect(html).toContain('data-bun-dev-server-script');
      expect(html).toContain('Home');
    }, 30_000);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('main').waitFor({ state: 'visible' });
    const stylesheetPath = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.css');
    originalStylesheet = await readFile(stylesheetPath, 'utf8');
    await writeFile(
      stylesheetPath,
      `${originalStylesheet}\nmain { background-color: rgb(255, 0, 0) !important; }\n`,
      'utf8'
    );

    await page.waitForFunction(() => {
      const main = document.querySelector('main');
      return main instanceof HTMLElement && getComputedStyle(main).backgroundColor === 'rgb(255, 0, 0)';
    });

    await context.close();
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    if (browser) {
      await browser.close();
    }
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
    if (originalStylesheet) {
      await writeFile(path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.css'), originalStylesheet, 'utf8');
    }
  }
}, 120_000);

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}

function spawnBunFirstWatch(workspace: string, port: number): {
  child: ReturnType<typeof Bun.spawn>;
  stdoutBuffer: { text: string };
  stderrBuffer: { text: string };
  stdoutDrain: Promise<void>;
  stderrDrain: Promise<void>;
} {
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
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  childProcesses.push(child);

  const stdoutBuffer = { text: '' };
  const stderrBuffer = { text: '' };

  return {
    child,
    stdoutBuffer,
    stderrBuffer,
    stdoutDrain: collectOutput(child.stdout, stdoutBuffer),
    stderrDrain: collectOutput(child.stderr, stderrBuffer),
  };
}
