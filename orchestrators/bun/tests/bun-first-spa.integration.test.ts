import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
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

test('Bun-first SPA watch serves distinct HTML for non-home pages', async () => {
  const workspaceCopy = await copyDemoWorkspace('spa', 'webstir-bun-first-spa-');
  const workspace = workspaceCopy.workspaceRoot;
  const addPageResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'add-page',
      'about',
      '--workspace',
      workspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(
    workspace,
    port,
  );

  try {
    expect(addPageResult.exitCode).toBe(0);

    await waitFor(async () => {
      const homeHtml = await fetchText(port, '/');
      const aboutHtml = await fetchText(port, '/about');
      expect(homeHtml).toContain('<title>Home</title>');
      expect(homeHtml).toContain('Home');
      expect(aboutHtml).toContain('<title>about</title>');
      expect(aboutHtml).toContain('Content for the about page.');
    }, 30_000);
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

test('Bun-first SPA watch uses Bun dev serving and hot-applies JavaScript edits', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'spa');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(
    workspace,
    port,
  );

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
      originalScript.replace("const homeMessage = 'Home';", "const homeMessage = 'Hot Bun Home';"),
      'utf8',
    );

    await page.waitForFunction(() => {
      const main = document.querySelector('main');
      return (
        main?.textContent?.includes('Hot Bun Home') &&
        main instanceof HTMLElement &&
        main.dataset.hmrRendered === '1'
      );
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
      await writeFile(
        path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.ts'),
        originalScript,
        'utf8',
      );
    }
  }
}, 120_000);

test('Bun-first SPA watch hot-applies CSS edits without a full page reload', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'spa');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(
    workspace,
    port,
  );

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
      'utf8',
    );

    await page.waitForFunction(
      () => getComputedStyle(document.body).backgroundColor === 'rgb(255, 0, 0)',
    );

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
      await writeFile(
        path.join(workspace, 'src', 'frontend', 'app', 'app.css'),
        originalStylesheet,
        'utf8',
      );
    }
  }
}, 120_000);

test('Bun-first SPA watch rebuilds transitive CSS imports and refreshes their graph', async () => {
  const workspaceCopy = await copyDemoWorkspace('spa', 'webstir-bun-first-spa-css-');
  const workspace = workspaceCopy.workspaceRoot;
  const appRoot = path.join(workspace, 'src', 'frontend', 'app');
  const stylesRoot = path.join(appRoot, 'styles');
  const appCssPath = path.join(appRoot, 'app.css');
  const firstLevelPath = path.join(stylesRoot, 'watch-first.css');
  const secondLevelPath = path.join(stylesRoot, 'watch-second.css');
  const addedPath = path.join(stylesRoot, 'watch-added.css');

  await mkdir(stylesRoot, { recursive: true });
  const appCss = await readFile(appCssPath, 'utf8');
  await Promise.all([
    writeFile(appCssPath, `@import "./styles/watch-first.css";\n${appCss}`, 'utf8'),
    writeFile(firstLevelPath, '@import "./watch-second.css";\n', 'utf8'),
    writeFile(secondLevelPath, ':root { --watch-state: nested-before; }\n', 'utf8'),
  ]);

  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(
    workspace,
    port,
  );

  try {
    await waitFor(async () => {
      expect(await fetchServedCss(port)).toContain('--watch-state: nested-before');
    }, 30_000);
    await writeFile(secondLevelPath, ':root { --watch-state: nested-after; }\n', 'utf8');
    await waitFor(async () => {
      expect(await fetchServedCss(port)).toContain('--watch-state: nested-after');
    }, 20_000);
    const initialGeneratedHtml = await readGeneratedHtml(workspace);

    await writeFile(addedPath, ':root { --watch-added: added-before; }\n', 'utf8');
    await writeFile(
      appCssPath,
      `@import "./styles/watch-added.css";\n@import "./styles/watch-first.css";\n${appCss}`,
      'utf8',
    );
    await waitFor(async () => {
      expect(await fetchServedCss(port)).toContain('--watch-added: added-before');
    }, 20_000);
    await waitFor(async () => {
      const generatedHtml = await readGeneratedHtml(workspace);
      expect(generatedHtml).not.toBe(initialGeneratedHtml);
      expect(await readGeneratedCss(workspace, generatedHtml)).toContain(
        '--watch-added: added-before',
      );
    }, 20_000);

    await writeFile(addedPath, ':root { --watch-added: added-after; }\n', 'utf8');
    await waitFor(async () => {
      expect(await fetchServedCss(port)).toContain('--watch-added: added-after');
    }, 20_000);
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}

async function fetchServedCss(port: number): Promise<string> {
  const html = await fetchText(port, '/');
  const stylesheetPath = html.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)/i)?.[1];
  if (!stylesheetPath) {
    throw new Error('Expected generated page to include a stylesheet.');
  }

  const stylesheetUrl = new URL(stylesheetPath, `http://127.0.0.1:${port}`);
  return await fetchText(port, `${stylesheetUrl.pathname}${stylesheetUrl.search}`);
}

async function readGeneratedHtml(workspace: string): Promise<string> {
  return await readFile(
    path.join(workspace, '.webstir', 'bun-first-spa', 'home', 'index.html'),
    'utf8',
  );
}

async function readGeneratedCss(workspace: string, html: string): Promise<string> {
  const stylesheetPath = html.match(/<link[^>]+href=["']([^"']+\.css)["']/i)?.[1];
  if (!stylesheetPath) {
    throw new Error('Expected generated page to reference generated CSS.');
  }
  return await readFile(
    path.resolve(workspace, '.webstir', 'bun-first-spa', 'home', stylesheetPath),
    'utf8',
  );
}

function spawnBunFirstWatch(
  workspace: string,
  port: number,
): {
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
