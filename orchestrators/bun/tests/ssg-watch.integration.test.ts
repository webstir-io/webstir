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

test('CLI watch hot-swaps SSG CSS edits without a full reload', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'ssg', 'base');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(workspace, port);

  let browser: Browser | undefined;
  let originalStylesheet = '';

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/')).toContain('Welcome to your Webstir site');
    }, 20_000);

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
    await page.waitForFunction(() => document.querySelector('main') instanceof HTMLElement);
    await page.evaluate(() => {
      (window as Window & { __webstirSsgCssMarker?: string }).__webstirSsgCssMarker = 'persist';
    });

    const stylesheetPath = path.join(workspace, 'src', 'frontend', 'app', 'app.css');
    originalStylesheet = await readFile(stylesheetPath, 'utf8');
    await writeFile(
      stylesheetPath,
      `${originalStylesheet}\nbody { background-color: rgb(255, 0, 0) !important; }\n`,
      'utf8'
    );

    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(255, 0, 0)');
    expect(await page.evaluate(() => (window as Window & { __webstirSsgCssMarker?: string }).__webstirSsgCssMarker ?? null)).toBe('persist');

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

test('CLI watch reloads SSG content edits after rebuild', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'ssg', 'base');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(workspace, port);

  let originalContent = '';

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/docs/')).toContain('Documentation');
    }, 20_000);

    const contentPath = path.join(workspace, 'src', 'frontend', 'content', 'hosting.md');
    originalContent = await readFile(contentPath, 'utf8');
    await writeFile(contentPath, originalContent.replace('Deploying your site', 'Hosting guide updated'), 'utf8');

    await waitFor(async () => {
      expect(await fetchText(port, '/docs/hosting')).toContain('Hosting guide updated');
    }, 20_000);
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
    if (originalContent) {
      await writeFile(path.join(workspace, 'src', 'frontend', 'content', 'hosting.md'), originalContent, 'utf8');
    }
  }
}, 120_000);

test('CLI watch hot-swaps docs page CSS edits without a full reload', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'ssg', 'base');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(workspace, port);

  let browser: Browser | undefined;
  let originalStylesheet = '';

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/docs/hosting')).toContain('Deploying your site');
    }, 20_000);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:${port}/docs/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.docs-layout') instanceof HTMLElement);
    await page.evaluate(() => {
      (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker = 'persist';
    });

    const stylesheetPath = path.join(workspace, 'src', 'frontend', 'pages', 'docs', 'index.css');
    originalStylesheet = await readFile(stylesheetPath, 'utf8');
    await writeFile(
      stylesheetPath,
      `${originalStylesheet}\n.docs-sidebar__title { color: rgb(0, 128, 0) !important; }\n`,
      'utf8'
    );

    await page.waitForFunction(() => {
      const title = document.querySelector('.docs-sidebar__title');
      return title instanceof HTMLElement && getComputedStyle(title).color === 'rgb(0, 128, 0)';
    });
    expect(await page.evaluate(() => (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker ?? null)).toBe('persist');

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
      await writeFile(path.join(workspace, 'src', 'frontend', 'pages', 'docs', 'index.css'), originalStylesheet, 'utf8');
    }
  }
}, 120_000);

test('CLI watch remounts the docs boundary for JS edits without a full reload', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'ssg', 'base');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(workspace, port);

  let browser: Browser | undefined;
  const browserLogs: string[] = [];

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/docs/')).toContain('Documentation');
    }, 20_000);

    browser = await chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      javaScriptEnabled: true,
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      browserLogs.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      browserLogs.push(`pageerror: ${error.message}`);
    });

    await page.goto(`http://127.0.0.1:${port}/docs/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('.docs-layout')?.dataset.webstirDocsBoundaryVersion === 'docs-boundary-v1'
    );
    expect(await page.evaluate(() => Boolean((window as Window & { __webstirDocsHot?: unknown }).__webstirDocsHot))).toBe(true);
    await page.evaluate(() => {
      (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker = 'persist';
    });

    const remountedVersion = await page.evaluate(async () => {
      const browserWindow = window as Window & {
        __webstirDocsBoundaryVersionOverride?: string;
        __webstirDocsBoundary?: { mount(root: Element): Promise<unknown>; unmount(): Promise<void> };
        __webstirDocsHot?: { accept(): Promise<boolean> };
      };

      browserWindow.__webstirDocsBoundaryVersionOverride = 'docs-boundary-v2-hot';

      const hot = browserWindow.__webstirDocsHot;
      if (!hot) {
        throw new Error('Missing docs hot hook.');
      }

      if (!browserWindow.__webstirDocsBoundary) {
        throw new Error('Missing docs boundary.');
      }

      const accepted = await hot.accept();
      if (!accepted) {
        throw new Error('Docs hot hook declined the update.');
      }
      return document.querySelector('.docs-layout')?.getAttribute('data-webstir-docs-boundary-version') ?? null;
    });

    expect(remountedVersion).toBe('docs-boundary-v2-hot');
    expect(await page.evaluate(() => (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker ?? null)).toBe('persist');
    expect(await page.locator('.docs-layout').textContent()).toContain('Documentation');

    await context.close();
  } catch (error) {
    if (error instanceof Error && browserLogs.length > 0) {
      error.message = `${error.message}\n\nbrowser:\n${browserLogs.join('\n')}`;
    }
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    if (browser) {
      await browser.close();
    }
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
  }
}, 120_000);

function spawnWatch(workspace: string, port: number): {
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

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}
