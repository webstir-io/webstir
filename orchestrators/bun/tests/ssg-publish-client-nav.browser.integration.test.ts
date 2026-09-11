import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import { getFreePort } from '../test-support/watch.ts';

type VisitWindow = Window & { clientNavVisits: number };

test('published SSG client-nav runs the incoming page setup after page scripts leave /pages/', async () => {
  const copy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-publish-client-nav');
  const workspace = copy.workspaceRoot;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let browser: Browser | undefined;

  try {
    await materializeRepoLocalWorkspaceDependencies(workspace, { installStdio: 'pipe' });
    runCli(workspace, ['enable', 'client-nav']);
    await writeLifecyclePage(workspace, 'home', '<a href="/second/">Second</a>');
    await writeLifecyclePage(workspace, 'second', '<a href="/">Home</a>');
    runCli(workspace, ['publish']);

    const distRoot = path.join(workspace, 'dist', 'frontend');
    expect(existsSync(path.join(distRoot, 'index.html'))).toBe(true);
    expect(existsSync(path.join(distRoot, 'second', 'index.html'))).toBe(true);

    const port = await getFreePort();
    server = serveStatic(distRoot, port);
    const origin = `http://127.0.0.1:${port}`;

    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as unknown as VisitWindow).clientNavVisits = 0;
      window.addEventListener('webstir:client-nav', () => {
        (window as unknown as VisitWindow).clientNavVisits += 1;
      });
    });

    await page.goto(`${origin}/`);
    await page.waitForFunction(() => document.querySelector('main')?.dataset.setup === 'home');
    const initialScript = await page.evaluate(
      () => document.querySelector('script[data-webstir-page]')?.getAttribute('src') ?? '',
    );
    // The scenario only exists because published SSG output relocates page entries.
    expect(initialScript.startsWith('/pages/')).toBe(false);
    expect(initialScript).toContain('/home/');

    await page.locator('main a[href="/second/"]').click();
    await page.waitForFunction(() => (window as unknown as VisitWindow).clientNavVisits === 1);
    expect(await readPageState(page)).toEqual({
      path: '/second/',
      setup: 'second',
      pageScripts: 1,
    });

    await page.locator('main a[href="/"]').click();
    await page.waitForFunction(() => (window as unknown as VisitWindow).clientNavVisits === 2);
    expect(await readPageState(page)).toEqual({ path: '/', setup: 'home', pageScripts: 1 });

    await page.goBack();
    await page.waitForFunction(() => (window as unknown as VisitWindow).clientNavVisits === 3);
    expect(await readPageState(page)).toEqual({
      path: '/second/',
      setup: 'second',
      pageScripts: 1,
    });

    expect(errors).toEqual([]);
    await page.close();
  } finally {
    await browser?.close();
    server?.stop(true);
    await removeDemoWorkspace(copy);
  }
}, 180_000);

async function readPageState(page: import('playwright').Page) {
  return page.evaluate(() => ({
    path: location.pathname,
    setup: document.querySelector('main')?.dataset.setup ?? null,
    pageScripts: document.querySelectorAll('script[data-webstir-page]').length,
  }));
}

async function writeLifecyclePage(workspace: string, name: string, link: string): Promise<void> {
  const pageDir = path.join(workspace, 'src', 'frontend', 'pages', name);
  await mkdir(pageDir, { recursive: true });
  await writeFile(
    path.join(pageDir, 'index.html'),
    [
      '<head>',
      `  <title>${name}</title>`,
      '  <script type="module" src="index.js"></script>',
      '</head>',
      '<body>',
      '  <main>',
      `    <h1>${name}</h1>`,
      `    ${link}`,
      '  </main>',
      '</body>',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    path.join(pageDir, 'index.ts'),
    [
      'export function setup({ root }: { root: HTMLElement }): void {',
      `  root.dataset.setup = '${name}';`,
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

function runCli(workspace: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      ...args,
      '--workspace',
      workspace,
    ],
    cwd: repoRoot,
    env: { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `webstir ${args.join(' ')} failed with exit code ${result.exitCode}.\nstdout:\n${result.stdout.toString()}\n\nstderr:\n${result.stderr.toString()}`,
    );
  }
}

function serveStatic(root: string, port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
      const filePath = path.join(root, relative);
      if (!filePath.startsWith(root)) {
        return new Response('Forbidden', { status: 403 });
      }
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      const indexFile = Bun.file(path.join(filePath, 'index.html'));
      if (await indexFile.exists()) {
        return new Response(indexFile);
      }
      return new Response('Not found', { status: 404 });
    },
  });
}
