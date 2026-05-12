import { afterAll, afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import {
  appendWatchLogs,
  collectOutput,
  getFreePort,
  removeTrackedChild,
  settleOutputDrains,
  stopSpawnedProcess,
  stopTrackedChildren,
  waitFor,
} from '../test-support/watch.ts';

const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];
let sharedBrowser: Browser | undefined;

afterAll(async () => {
  if (sharedBrowser) {
    await Promise.race([sharedBrowser.close(), Bun.sleep(5_000)]);
    sharedBrowser = undefined;
  }
});

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
});

test('CLI watch reloads SSG content edits after rebuild', async () => {
  const workspaceCopy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-watch-content');
  const workspace = workspaceCopy.workspaceRoot;
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(
    workspace,
    port,
  );

  let originalContent = '';

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/docs/')).toContain('Documentation');
    }, 20_000);

    const contentPath = path.join(workspace, 'src', 'frontend', 'content', 'hosting.md');
    originalContent = await readFile(contentPath, 'utf8');
    await writeFile(
      contentPath,
      originalContent.replace('Deploying your site', 'Hosting guide updated'),
      'utf8',
    );

    await waitFor(async () => {
      expect(await fetchText(port, '/docs/hosting')).toContain('Hosting guide updated');
    }, 20_000);
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    await stopSpawnedProcess(child);
    await settleOutputDrains(stdoutDrain, stderrDrain);
    removeTrackedChild(childProcesses, child);
    if (originalContent) {
      await writeFile(
        path.join(workspace, 'src', 'frontend', 'content', 'hosting.md'),
        originalContent,
        'utf8',
      );
    }
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

test('CLI build and publish refuse while SSG watch owns a workspace with static font assets', async () => {
  const workspaceCopy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-watch-lock');
  const workspace = workspaceCopy.workspaceRoot;
  await addSelfHostedFontAssets(workspace);

  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(
    workspace,
    port,
  );

  const spawnedCommands: Array<ReturnType<typeof Bun.spawn>> = [];

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/docs/')).toContain('Documentation');
    }, 20_000);
    const fontResponse = await fetch(`http://127.0.0.1:${port}/fonts/IBM-Plex-Sans.woff2`);
    expect(fontResponse.ok).toBe(true);

    await expectPipelineCommandRefused(workspace, 'build', spawnedCommands);
    await expectPipelineCommandRefused(workspace, 'publish', spawnedCommands);
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    for (const commandChild of spawnedCommands) {
      await stopSpawnedProcess(commandChild);
      removeTrackedChild(childProcesses, commandChild);
    }
    await stopSpawnedProcess(child);
    await settleOutputDrains(stdoutDrain, stderrDrain);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

test('CLI watch hot-swaps docs page CSS edits without a full reload', async () => {
  const workspaceCopy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-watch-css');
  const workspace = workspaceCopy.workspaceRoot;
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(
    workspace,
    port,
  );

  let context: BrowserContext | undefined;
  let originalStylesheet = '';

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/docs/hosting')).toContain('Deploying your site');
    }, 20_000);

    context = await createBrowserContext();
    const page = await context.newPage();

    await page.goto(`http://127.0.0.1:${port}/docs/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => document.querySelector('.docs-layout') instanceof HTMLElement,
      undefined,
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker = 'persist';
    });
    await waitForHmrRuntime(page);

    const stylesheetPath = path.join(workspace, 'src', 'frontend', 'pages', 'docs', 'index.css');
    originalStylesheet = await readFile(stylesheetPath, 'utf8');
    await writeFile(
      stylesheetPath,
      `${originalStylesheet}\n.docs-sidebar__title { color: rgb(0, 128, 0) !important; }\n`,
      'utf8',
    );

    await page.waitForFunction(
      () => {
        const title = document.querySelector('.docs-sidebar__title');
        return title instanceof HTMLElement && getComputedStyle(title).color === 'rgb(0, 128, 0)';
      },
      undefined,
      { timeout: 15_000 },
    );
    expect(
      await page.evaluate(
        () => (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker ?? null,
      ),
    ).toBe('persist');
  } catch (error) {
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    if (context) {
      await closeBrowserContext(context);
    }
    await stopSpawnedProcess(child);
    await settleOutputDrains(stdoutDrain, stderrDrain);
    removeTrackedChild(childProcesses, child);
    if (originalStylesheet) {
      await writeFile(
        path.join(workspace, 'src', 'frontend', 'pages', 'docs', 'index.css'),
        originalStylesheet,
        'utf8',
      );
    }
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

test('CLI watch remounts the docs sidebar boundary for JS edits without a full reload', async () => {
  const workspaceCopy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-watch-js');
  const workspace = workspaceCopy.workspaceRoot;
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(
    workspace,
    port,
  );

  let context: BrowserContext | undefined;
  const browserLogs: string[] = [];
  let originalDocsPage = '';

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/docs/')).toContain('Documentation');
    }, 20_000);

    context = await createBrowserContext();
    const page = await context.newPage();
    page.on('console', (message) => {
      browserLogs.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      browserLogs.push(`pageerror: ${error.message}`);
    });

    await page.goto(`http://127.0.0.1:${port}/docs/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => {
        const layout = document.querySelector('.docs-layout');
        const links = document.querySelector('#docs-links');
        return (
          layout?.dataset.webstirDocsBoundaryVersion === 'docs-boundary-v1' &&
          links?.dataset.webstirDocsSidebarBoundaryVersion === 'docs-sidebar-v1'
        );
      },
      undefined,
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker = 'persist';
    });
    await waitForHmrRuntime(page);

    const docsPagePath = path.join(workspace, 'src', 'frontend', 'pages', 'docs', 'index.ts');
    originalDocsPage = await readFile(docsPagePath, 'utf8');
    await writeFile(
      docsPagePath,
      originalDocsPage.replace('docs-sidebar-v1', 'docs-sidebar-v2'),
      'utf8',
    );

    await page.waitForFunction(
      () =>
        document.querySelector('#docs-links')?.dataset.webstirDocsSidebarBoundaryVersion ===
        'docs-sidebar-v2',
      undefined,
      { timeout: 15_000 },
    );
    expect(
      await page.locator('.docs-layout').getAttribute('data-webstir-docs-boundary-version'),
    ).toBe('docs-boundary-v1');
    expect(
      await page.locator('#docs-links').getAttribute('data-webstir-docs-sidebar-boundary-version'),
    ).toBe('docs-sidebar-v2');
    expect(
      await page.evaluate(
        () => (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker ?? null,
      ),
    ).toBe('persist');
    expect(await page.locator('.docs-layout').textContent()).toContain('Documentation');
  } catch (error) {
    if (error instanceof Error && browserLogs.length > 0) {
      error.message = `${error.message}\n\nbrowser:\n${browserLogs.join('\n')}`;
    }
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    if (context) {
      await closeBrowserContext(context);
    }
    await stopSpawnedProcess(child);
    await settleOutputDrains(stdoutDrain, stderrDrain);
    removeTrackedChild(childProcesses, child);
    if (originalDocsPage) {
      await writeFile(
        path.join(workspace, 'src', 'frontend', 'pages', 'docs', 'index.ts'),
        originalDocsPage,
        'utf8',
      );
    }
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

test('CLI watch remounts the docs boundary for _sidebar.json edits without a full reload', async () => {
  const workspaceCopy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-watch-sidebar');
  const workspace = workspaceCopy.workspaceRoot;
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(
    workspace,
    port,
  );

  let context: BrowserContext | undefined;
  const browserLogs: string[] = [];
  let originalSidebar = '';

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/docs/')).toContain('Documentation');
    }, 20_000);

    context = await createBrowserContext();
    const page = await context.newPage();
    page.on('console', (message) => {
      browserLogs.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      browserLogs.push(`pageerror: ${error.message}`);
    });

    await page.goto(`http://127.0.0.1:${port}/docs/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => (document.querySelector('#docs-links')?.textContent ?? '').trim().length > 0,
      undefined,
      { timeout: 15_000 },
    );
    const initialSidebarText = (await page.locator('#docs-links').textContent()) ?? '';
    await page.evaluate(() => {
      (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker = 'persist';
    });
    await waitForHmrRuntime(page);

    const sidebarPath = path.join(workspace, 'src', 'frontend', 'content', '_sidebar.json');
    originalSidebar = await readFile(sidebarPath, 'utf8');
    const sidebarJson = JSON.parse(originalSidebar) as {
      pages?: Array<{ path?: string; title?: string; order?: number }>;
    };
    const updatedSidebar = {
      ...sidebarJson,
      pages: Array.isArray(sidebarJson.pages)
        ? sidebarJson.pages.map((entry) =>
            entry.path === '/docs/hosting/' ? { ...entry, title: 'Hosting hot updated' } : entry,
          )
        : sidebarJson.pages,
    };
    const sidebarHandle = await open(sidebarPath, 'r+');
    try {
      await sidebarHandle.truncate(0);
      await sidebarHandle.writeFile(`${JSON.stringify(updatedSidebar, null, 2)}\n`, 'utf8');
    } finally {
      await sidebarHandle.close();
    }

    await waitFor(async () => {
      expect(await fetchText(port, '/docs-nav.json')).toContain('Hosting hot updated');
    }, 20_000);
    await page.waitForFunction(
      (previousText) => (document.querySelector('#docs-links')?.textContent ?? '') !== previousText,
      initialSidebarText,
      { timeout: 15_000 },
    );
    expect(await page.locator('#docs-links').textContent()).toContain('Hosting hot updated');
    expect(
      await page.evaluate(
        () => (window as Window & { __webstirDocsMarker?: string }).__webstirDocsMarker ?? null,
      ),
    ).toBe('persist');
  } catch (error) {
    if (error instanceof Error && browserLogs.length > 0) {
      error.message = `${error.message}\n\nbrowser:\n${browserLogs.join('\n')}`;
    }
    throw appendWatchLogs(error, stdoutBuffer.text, stderrBuffer.text);
  } finally {
    if (context) {
      await closeBrowserContext(context);
    }
    await stopSpawnedProcess(child);
    await settleOutputDrains(stdoutDrain, stderrDrain);
    removeTrackedChild(childProcesses, child);
    if (originalSidebar) {
      await writeFile(
        path.join(workspace, 'src', 'frontend', 'content', '_sidebar.json'),
        originalSidebar,
        'utf8',
      );
    }
    await removeDemoWorkspace(workspaceCopy);
  }
}, 120_000);

function spawnWatch(
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

async function expectPipelineCommandRefused(
  workspace: string,
  command: 'build' | 'publish',
  spawnedCommands: Array<ReturnType<typeof Bun.spawn>>,
): Promise<void> {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      command,
      '--workspace',
      workspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  childProcesses.push(child);
  spawnedCommands.push(child);

  const stdoutBuffer = { text: '' };
  const stderrBuffer = { text: '' };
  const stdoutDrain = collectOutput(child.stdout, stdoutBuffer);
  const stderrDrain = collectOutput(child.stderr, stderrBuffer);

  expect(await child.exited).toBe(1);
  await settleOutputDrains(stdoutDrain, stderrDrain);
  expect(stderrBuffer.text).toContain(
    `Cannot run webstir ${command} because webstir watch is active`,
  );
  expect(stdoutBuffer.text).not.toContain(`[webstir] ${command} complete`);
}

async function closeBrowserContext(context: BrowserContext): Promise<void> {
  await Promise.race([context.close(), Bun.sleep(5_000)]);
}

async function createBrowserContext(): Promise<BrowserContext> {
  sharedBrowser ??= await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  const context = await sharedBrowser.newContext({
    javaScriptEnabled: true,
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript(() => {
    const originalAddEventListener = EventSource.prototype.addEventListener;
    EventSource.prototype.addEventListener = function (
      this: EventSource,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      if (type === 'hmr') {
        (
          window as Window & { __webstirHmrListenerRegistered?: boolean }
        ).__webstirHmrListenerRegistered = true;
      }
      originalAddEventListener.call(this, type, listener, options);
    };
  });
  return context;
}

async function waitForHmrRuntime(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const runtime = window as Window & {
        __webstirEventSource?: EventSource;
        __webstirHmrListenerRegistered?: boolean;
      };
      return (
        runtime.__webstirHmrListenerRegistered === true &&
        runtime.__webstirEventSource instanceof EventSource &&
        runtime.__webstirEventSource.readyState === EventSource.OPEN
      );
    },
    undefined,
    { timeout: 10_000 },
  );
}

async function addSelfHostedFontAssets(workspace: string): Promise<void> {
  const fontsRoot = path.join(workspace, 'src', 'frontend', 'fonts');
  await mkdir(fontsRoot, { recursive: true });
  await writeFile(path.join(fontsRoot, 'IBM-Plex-Sans.woff2'), 'webstir-font-fixture', 'utf8');
  await writeFile(path.join(fontsRoot, 'IBM-Plex-OFL-1.1.txt'), 'Font fixture license.\n', 'utf8');

  const appCssPath = path.join(workspace, 'src', 'frontend', 'app', 'app.css');
  const appCss = await readFile(appCssPath, 'utf8');
  await writeFile(
    appCssPath,
    `${appCss}\n@font-face {\n  font-family: "IBM Plex Sans Fixture";\n  src: url("/fonts/IBM-Plex-Sans.woff2") format("woff2");\n}\n`,
    'utf8',
  );
}

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}
