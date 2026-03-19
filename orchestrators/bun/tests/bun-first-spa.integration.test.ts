import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';
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
const unsupportedWorkspaces = [
  {
    fixtureRoot: path.join(repoRoot, 'examples', 'demos', 'ssg', 'base'),
    directoryName: 'ssg-base',
    workspaceName: 'webstir-demo-ssg-base',
    mode: 'ssg',
  },
  {
    fixtureRoot: path.join(repoRoot, 'examples', 'demos', 'api'),
    directoryName: 'api',
    workspaceName: 'webstir-demo-api',
    mode: 'api',
  },
] as const;

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
});

test('Bun-first SPA watch uses Bun dev serving and hot-applies JavaScript edits', async () => {
  const workspaceCopy = await copyDemoWorkspace('spa', 'webstir-bun-first-spa');
  const workspace = workspaceCopy.workspaceRoot;
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(workspace, port);

  let browser: Browser | undefined;

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
    const originalScript = await readFile(scriptPath, 'utf8');
    await writeFile(
      scriptPath,
      originalScript.replace(
        "main.dataset.hmrRendered = String(Date.now());",
        "main.dataset.hmrRendered = 'bun-updated';\n  main.textContent = 'Hot Bun Home';"
      ),
      'utf8'
    );

    await page.waitForFunction(() => {
      const main = document.querySelector('main');
      return main?.textContent?.includes('Hot Bun Home') && main instanceof HTMLElement && main.dataset.hmrRendered === 'bun-updated';
    });

    expect(await page.evaluate(() => (window as Window & { __bunFirstMarker?: string }).__bunFirstMarker)).toBe('persist');

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
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

test('Bun-first SPA watch hot-applies CSS edits without a full page reload', async () => {
  const workspaceCopy = await copyDemoWorkspace('spa', 'webstir-bun-first-spa');
  const workspace = workspaceCopy.workspaceRoot;
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(workspace, port);

  let browser: Browser | undefined;

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

    const stylesheetPath = path.join(workspace, 'src', 'frontend', 'app', 'app.css');
    const originalStylesheet = await readFile(stylesheetPath, 'utf8');
    await writeFile(
      stylesheetPath,
      `${originalStylesheet}\nbody { background: rgb(255, 0, 0); }\n`,
      'utf8'
    );

    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === 'rgb(255, 0, 0)');

    expect(await page.evaluate(() => (window as Window & { __bunFirstMarker?: string }).__bunFirstMarker)).toBe('persist');

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
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

test('Bun-first SPA watch hot-applies page CSS edits without a full page reload', async () => {
  const workspaceCopy = await copyDemoWorkspace('spa', 'webstir-bun-first-spa');
  const workspace = workspaceCopy.workspaceRoot;
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(workspace, port);

  let browser: Browser | undefined;

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

    const stylesheetPath = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.css');
    const originalStylesheet = await readFile(stylesheetPath, 'utf8');
    await writeFile(
      stylesheetPath,
      `${originalStylesheet}\nmain { color: rgb(255, 0, 0); }\n`,
      'utf8'
    );

    await page.waitForFunction(() => getComputedStyle(document.querySelector('main')!).color === 'rgb(255, 0, 0)');

    expect(await page.evaluate(() => (window as Window & { __bunFirstMarker?: string }).__bunFirstMarker)).toBe('persist');

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
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

for (const unsupportedWorkspace of unsupportedWorkspaces) {
  test(`Bun-first SPA watch rejects ${unsupportedWorkspace.mode} workspaces with a clear runtime error`, async () => {
    const workspaceCopy = await copyWorkspace(unsupportedWorkspace.fixtureRoot, unsupportedWorkspace.directoryName);
    const workspace = workspaceCopy.workspaceRoot;
    const port = await getFreePort();
    const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnBunFirstWatch(workspace, port);

    try {
      expect(await child.exited).toBe(1);
      await Promise.allSettled([stdoutDrain, stderrDrain]);
      expect(stdoutBuffer.text).toBe('');
      expect(stderrBuffer.text).toContain(
        `[webstir] watch failed: Frontend runtime "bun" currently supports spa and full workspaces only. "${unsupportedWorkspace.workspaceName}" is ${unsupportedWorkspace.mode}.`
      );
    } finally {
      child.kill('SIGTERM');
      await child.exited.catch(() => undefined);
      await Promise.allSettled([stdoutDrain, stderrDrain]);
      removeTrackedChild(childProcesses, child);
      await removeDemoWorkspace(workspaceCopy);
    }
  });
}

async function copyWorkspace(fixtureRoot: string, directoryName: string) {
  const workspaceCopy = await copyDemoWorkspace(
    path.relative(path.join(repoRoot, 'examples', 'demos'), fixtureRoot),
    `webstir-bun-first-${directoryName}`,
    { workspaceName: directoryName }
  );
  const workspace = workspaceCopy.workspaceRoot;
  await Promise.all([
    rm(path.join(workspace, 'build'), { recursive: true, force: true }),
    rm(path.join(workspace, 'dist'), { recursive: true, force: true }),
    rm(path.join(workspace, 'node_modules'), { recursive: true, force: true }),
    rm(path.join(workspace, '.webstir'), { recursive: true, force: true }),
  ]);
  return workspaceCopy;
}

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
      '--frontend-runtime',
      'bun',
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
