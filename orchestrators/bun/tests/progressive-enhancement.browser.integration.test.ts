import { afterEach, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { DevServer } from '../src/dev-server.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';

const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];
const browsers: Browser[] = [];

afterEach(async () => {
  while (browsers.length > 0) {
    const browser = browsers.pop();
    if (!browser) {
      continue;
    }

    await browser.close().catch(() => undefined);
  }

  while (childProcesses.length > 0) {
    const child = childProcesses.pop();
    if (!child) {
      continue;
    }

    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
  }
});

test('browser progressive enhancement flows work in watch mode', async () => {
  const workspace = await copyFullDemoWorkspace('webstir-progressive-watch-');
  let session: RuntimeSession | undefined;

  try {
    session = await startWatchSession(workspace);
    await exerciseBrowserScenario(session.origin);
  } catch (error) {
    throw appendLogs(error, session?.logs ?? {});
  } finally {
    if (session) {
      await session.stop();
    }
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

test('browser progressive enhancement flows work in publish mode', async () => {
  const workspace = await copyFullDemoWorkspace('webstir-progressive-publish-');
  let session: RuntimeSession | undefined;

  try {
    session = await startPublishSession(workspace);
    await exerciseBrowserScenario(session.origin);
  } catch (error) {
    throw appendLogs(error, session?.logs ?? {});
  } finally {
    if (session) {
      await session.stop();
    }
    await rm(path.dirname(workspace), { recursive: true, force: true });
  }
}, 120_000);

async function exerciseBrowserScenario(origin: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  browsers.push(browser);

  const fragmentContext = await browser.newContext({
    javaScriptEnabled: true,
    viewport: { width: 1280, height: 720 }
  });
  const fragmentPage = await fragmentContext.newPage();

  try {
    await fragmentPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await fragmentPage.locator('a[href="/api/demo/progressive-enhancement"]').click();
    await fragmentPage.waitForURL(`${origin}/api/demo/progressive-enhancement`);
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

  await page.locator('a[href="/"]').click();
  await page.waitForURL(`${origin}/`);
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

  await page.locator('a[href="/api/demo/progressive-enhancement"]').click();
  await page.waitForURL(`${origin}/api/demo/progressive-enhancement`);
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

async function copyFullDemoWorkspace(prefix: string): Promise<string> {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', 'full');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const workspace = path.join(tempRoot, 'full');
  await cp(fixtureRoot, workspace, { recursive: true });
  await Promise.all([
    rm(path.join(workspace, 'build'), { recursive: true, force: true }),
    rm(path.join(workspace, 'dist'), { recursive: true, force: true }),
    rm(path.join(workspace, 'node_modules'), { recursive: true, force: true })
  ]);
  return workspace;
}

async function startWatchSession(workspace: string): Promise<RuntimeSession> {
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
  childProcesses.push(child);

  const stdout = { text: '' };
  const stderr = { text: '' };
  const stdoutDrain = collectOutput(child.stdout, stdout);
  const stderrDrain = collectOutput(child.stderr, stderr);

  await waitFor(async () => {
    expect(stdout.text).toContain('[webstir] watch starting');
    expect(stdout.text).toContain('[webstir] backend ready at');
    expect(await fetchText(port, '/')).toContain('Home');
    expect(await fetchText(port, '/api')).toContain('API server running');
  }, 30_000);

  return {
    origin: `http://127.0.0.1:${port}`,
    logs: {
      watchStdout: stdout.text,
      watchStderr: stderr.text
    },
    async stop() {
      child.kill('SIGTERM');
      await child.exited.catch(() => undefined);
      await Promise.allSettled([stdoutDrain, stderrDrain]);
      removeChildProcess(child);
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
  childProcesses.push(backendChild);

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
    logs: {
      publishStdout,
      publishStderr,
      backendStdout: backendStdout.text,
      backendStderr: backendStderr.text
    },
    async stop() {
      await server.stop();
      backendChild.kill('SIGTERM');
      await backendChild.exited.catch(() => undefined);
      await Promise.allSettled([backendStdoutDrain, backendStderrDrain]);
      removeChildProcess(backendChild);
    }
  };
}

function removeChildProcess(child: ReturnType<typeof Bun.spawn>): void {
  const index = childProcesses.indexOf(child);
  if (index >= 0) {
    childProcesses.splice(index, 1);
  }
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

interface RuntimeSession {
  readonly origin: string;
  readonly logs: Record<string, string>;
  stop(): Promise<void>;
}
