import { afterEach, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright';

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

test('browser auth and CRUD flows work in watch mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-auth-crud-watch-');
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

test('browser auth and CRUD flows work in publish mode', async () => {
  const workspace = await copyDemoWorkspace('webstir-auth-crud-publish-');
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

  const enhancedContext = await browser.newContext({
    javaScriptEnabled: true,
    viewport: { width: 1280, height: 720 }
  });
  const enhancedPage = await enhancedContext.newPage();

  try {
    await enhancedPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await enhancedPage.locator('a[href="/api/demo/auth-crud"]').click();
    await enhancedPage.waitForURL(`${origin}/api/demo/auth-crud`);
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

    await projectRow.locator(`input[name="title"]`).fill('Browser launch checklist updated');
    await projectRow.locator(`textarea[name="notes"]`).fill('Updated through the enhanced fragment path.');
    await projectRow.locator(`[data-project-save="${projectId}"]`).click();
    await enhancedPage.waitForFunction(
      (id) => document.querySelector(`[data-project-id="${id}"] h4`)?.textContent === 'Browser launch checklist updated',
      projectId
    );

    await enhancedPage.reload({ waitUntil: 'domcontentloaded' });
    await enhancedPage.locator(`[data-project-id="${projectId}"]`).waitFor({ state: 'visible' });
    expect(await enhancedPage.locator(`[data-project-id="${projectId}"] h4`).textContent()).toBe('Browser launch checklist updated');

    await enhancedPage.locator(`[data-project-delete="${projectId}"]`).click();
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

    await baselinePage.locator('#auth-email').fill('native@example.com');
    await baselinePage.locator('#auth-sign-in-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await baselinePage.waitForFunction(() =>
      window.location.pathname === '/api/demo/auth-crud'
      && document.body.textContent?.includes('Signed in as native@example.com.')
    );

    await baselinePage.locator('#project-title').fill('Native create project');
    await baselinePage.locator('#project-status').selectOption('active');
    await baselinePage.locator('#project-notes').fill('Created through the no-JavaScript redirect path.');
    await baselinePage.locator('#project-create-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    await baselinePage.waitForFunction(() =>
      window.location.pathname === '/api/demo/auth-crud'
      && document.body.textContent?.includes('Created project "Native create project".')
    );

    expect(await baselinePage.locator('body').textContent()).toContain('Native create project');
  } finally {
    await baselineContext.close().catch(() => undefined);
  }
}

async function copyDemoWorkspace(prefix: string): Promise<string> {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', 'auth-crud');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  const workspace = path.join(tempRoot, 'auth-crud');
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

function appendLogs(error: unknown, logs: Record<string, string>): Error {
  const message = error instanceof Error ? error.message : String(error);
  const sections = Object.entries(logs)
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}:\n${value}`);
  return new Error(sections.length > 0 ? `${message}\n\n${sections.join('\n\n')}` : message);
}

interface RuntimeSession {
  readonly origin: string;
  readonly logs: Record<string, string>;
  stop(): Promise<void>;
}
