import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import { runWebstirOrThrow } from '../test-support/cli.ts';
import { getFreePort } from '../test-support/watch.ts';

type VisitWindow = Window & { clientNavVisits: number };

test('published SSG client-nav runs the incoming page setup after page scripts leave /pages/', async () => {
  const copy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-publish-client-nav');
  const workspace = copy.workspaceRoot;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let browser: Browser | undefined;

  try {
    await step('install', () =>
      materializeRepoLocalWorkspaceDependencies(workspace, { installStdio: 'pipe' }),
    );
    await step('enable client-nav', () => runCli(workspace, ['enable', 'client-nav']));
    await writeLifecyclePage(workspace, 'home', '<a href="/second/">Second</a>');
    await writeLifecyclePage(workspace, 'second', '<a href="/">Home</a>');
    await step('publish', () => runCli(workspace, ['publish']));

    const distRoot = path.join(workspace, 'dist', 'frontend');
    expect(existsSync(path.join(distRoot, 'index.html'))).toBe(true);
    expect(existsSync(path.join(distRoot, 'second', 'index.html'))).toBe(true);

    const port = await getFreePort();
    server = serveStatic(distRoot, port);
    const origin = `http://127.0.0.1:${port}`;

    browser = await step('launch chromium', () =>
      chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'], timeout: 60_000 }),
    );
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      (window as unknown as VisitWindow).clientNavVisits = 0;
      window.addEventListener('webstir:client-nav', () => {
        (window as unknown as VisitWindow).clientNavVisits += 1;
      });
    });

    await step('open home', () => page.goto(`${origin}/`));
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

test('a published site without a server shows a page at the addresses its views route to', async () => {
  const copy = await copyDemoWorkspace('spa', 'webstir-static-page-routes');
  const workspace = copy.workspaceRoot;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let browser: Browser | undefined;

  try {
    await materializeRepoLocalWorkspaceDependencies(workspace, { installStdio: 'pipe' });
    const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'items');
    await mkdir(pageDir, { recursive: true });
    await writeFile(
      path.join(pageDir, 'index.html'),
      '<head><title>Item</title><script type="module" src="index.js"></script></head><body><main><h1>Item</h1></main></body>\n',
      'utf8',
    );
    // The page reads which item from the address, as a page whose data loads in the browser does.
    await writeFile(
      path.join(pageDir, 'index.ts'),
      "export function setup({ root, url }: { root: HTMLElement; url: URL }): void {\n  root.dataset.item = url.pathname.split('/').filter(Boolean).pop() ?? '';\n}\n",
      'utf8',
    );
    // The app's own 404 page loads the app's scripts; a routed page must still run its own.
    const notFoundDir = path.join(workspace, 'src', 'frontend', 'pages', '404');
    await mkdir(notFoundDir, { recursive: true });
    await writeFile(
      path.join(notFoundDir, 'index.html'),
      '<head><title>Lost</title></head><body><main><h1>Lost at sea</h1></main></body>\n',
      'utf8',
    );
    const packageJsonPath = path.join(workspace, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    packageJson.webstir.moduleManifest = {
      views: [
        { name: 'item', path: '/items/:id', page: 'items' },
        { name: 'featured', path: '/featured', page: 'items' },
      ],
    };
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    await runCli(workspace, ['publish']);

    const distRoot = path.join(workspace, 'dist', 'frontend');
    expect(await readFile(path.join(distRoot, '_redirects'), 'utf8')).toBe(
      '/items/:id /items/ 200\n',
    );
    expect(existsSync(path.join(distRoot, 'featured', 'index.html'))).toBe(true);
    expect(await readFile(path.join(distRoot, '404.html'), 'utf8')).toContain('/items/:id');

    const port = await getFreePort();
    server = serveStatic(distRoot, port);
    const origin = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    for (const [address, item] of [
      ['/items/42', '42'],
      ['/featured/', 'featured'],
    ] as const) {
      await page.goto(`${origin}${address}`);
      await page.waitForSelector(`main[data-item="${item}"]`, { timeout: 10_000 });
      expect(await page.evaluate(() => location.pathname)).toBe(address);
    }

    await page.goto(`${origin}/nowhere/at/all`);
    await page.waitForSelector('main h1');
    expect(await page.textContent('main h1')).toBe('Lost at sea');
    expect(errors).toEqual([]);
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

/** Names each setup step and its time, so a step that hangs in CI shows which one it was. */
async function step<T>(label: string, run: () => T | Promise<T>): Promise<T> {
  const started = performance.now();
  console.error(`[ssg-publish-client-nav] ${label}: started`);
  const result = await run();
  console.error(
    `[ssg-publish-client-nav] ${label}: done in ${Math.round(performance.now() - started)}ms`,
  );
  return result;
}

async function runCli(workspace: string, args: string[]): Promise<void> {
  await runWebstirOrThrow([...args, '--workspace', workspace], {
    env: { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' },
  });
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
      // Like GitHub Pages: a missing address gets the site's 404.html, with a 404 status.
      const notFound = Bun.file(path.join(root, '404.html'));
      if (await notFound.exists()) {
        return new Response(notFound, { status: 404, headers: { 'content-type': 'text/html' } });
      }
      return new Response('Not found', { status: 404 });
    },
  });
}
