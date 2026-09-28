import { expect, test } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';
import { getFreePort } from '../test-support/watch.ts';

// A page with a data.ts renders in the browser from the same template a server would use: its
// first load shows the initial data, then what `load` returns; `render` updates it in place and
// keeps focus. With client-nav, navigating to it never shows the initial data.
for (const clientNav of [false, true]) {
  test(`a browser-rendered page loads, renders and re-renders ${clientNav ? 'with' : 'without'} client-nav`, async () => {
    const copy = await copyDemoWorkspace('ssg/base', 'webstir-browser-rendered');
    const workspace = copy.workspaceRoot;
    let server: ReturnType<typeof Bun.serve> | undefined;
    let browser: Browser | undefined;

    try {
      await addDependency(workspace, 'zod', '^3.23.8');
      await materializeRepoLocalWorkspaceDependencies(workspace, { installStdio: 'pipe' });
      if (clientNav) runCli(workspace, ['enable', 'client-nav']);
      await writeFruitPage(workspace);
      await writeBrokenPage(workspace);
      await writeHomeLink(workspace);
      runCli(workspace, ['publish']);

      const distRoot = path.join(workspace, 'dist', 'frontend');
      const firstLoad = await readFile(path.join(distRoot, 'fruit', 'index.html'), 'utf8');
      expect(firstLoad).toContain('<p id="status">Loading</p>');
      expect(firstLoad).not.toMatch(/data-(text|each|if|attr-)/);

      const port = await getFreePort();
      server = serveStatic(distRoot, port);
      const origin = `http://127.0.0.1:${port}`;
      browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      // First load: the initial data, then the loaded data, then ready.
      await page.goto(`${origin}/fruit/`);
      await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
      expect(await readFruit(page)).toEqual({
        title: 'Fruit',
        status: 'Loaded',
        items: ['apple', 'banana', 'cherry'],
      });

      // The browser rendered exactly what the server renders from the same template and data.
      const serverHtml = await renderOnServer(workspace, {
        title: 'Fruit',
        status: 'Loaded',
        filter: '',
        items: ['apple', 'banana', 'cherry'],
      });
      const [browserMain, serverMain] = await page.evaluate((html) => {
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        return [document.querySelector('main')?.innerHTML, parsed.querySelector('main')?.innerHTML];
      }, serverHtml);
      expect(browserMain).toBe(serverMain);

      // render(): typing filters the list in place, and the input keeps focus and caret.
      await page.locator('#filter').click();
      await page.keyboard.type('an');
      await page.waitForFunction(() => document.querySelectorAll('main li').length === 1);
      expect(await readFruit(page)).toMatchObject({ items: ['banana'] });
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('filter');
      expect(await page.locator('#filter').inputValue()).toBe('an');

      if (clientNav) {
        // Navigating in: the swap happens once the data is loaded, so the initial data never shows.
        await page.goto(`${origin}/`);
        await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
        await page.evaluate(() => {
          const seen: string[] = [];
          (window as unknown as { seenStatus: string[] }).seenStatus = seen;
          new MutationObserver(() => {
            const status = document.querySelector('#status')?.textContent;
            if (status) seen.push(status);
          }).observe(document.body, { childList: true, subtree: true, characterData: true });
          (window as unknown as { documentId: string }).documentId = 'home';
        });
        await page.locator('main a[href="/fruit/"]').click();
        await page.waitForFunction(() => location.pathname === '/fruit/');
        await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
        expect(await readFruit(page)).toMatchObject({
          status: 'Loaded',
          items: ['apple', 'banana', 'cherry'],
        });
        const seen = await page.evaluate(
          () => (window as unknown as { seenStatus: string[] }).seenStatus,
        );
        expect(seen).not.toContain('Loading');
        expect(
          await page.evaluate(() => (window as unknown as { documentId?: string }).documentId),
        ).toBe('home');

        // Data the template can't render falls back to a normal page load instead of a dead link.
        await page.goto(`${origin}/`);
        await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
        await page.evaluate(() => {
          (window as unknown as { documentId: string }).documentId = 'home';
        });
        await page.locator('main a[href="/broken/"]').click();
        await page.waitForFunction(() => location.pathname === '/broken/');
        await page.waitForFunction(
          () => (window as unknown as { documentId?: string }).documentId === undefined,
        );
      }

      expect(errors).toEqual([]);
      await page.close();
    } finally {
      await browser?.close();
      server?.stop(true);
      await removeDemoWorkspace(copy);
    }
  }, 240_000);
}

/** The page rendered the way a server view renders it: the same compiler and executor. */
async function renderOnServer(workspace: string, data: unknown): Promise<string> {
  const { compileRenderProgram, prepareTemplateSource } = await import(
    '@webstir-io/webstir-frontend'
  );
  const { executeRenderProgram } = await import('@webstir-io/module-contract');
  const file = path.join(workspace, 'src', 'frontend', 'pages', 'fruit', 'index.html');
  const prepared = await prepareTemplateSource(await readFile(file, 'utf8'), file, {
    workspaceRoot: workspace,
    partialsRoot: path.join(workspace, 'src', 'frontend', 'app', 'partials'),
  });
  const program = compileRenderProgram(prepared, {
    page: 'fruit',
    source: 'src/frontend/pages/fruit/index.html',
  });
  return executeRenderProgram(program, data, { csrfToken: false });
}

async function readFruit(page: Page) {
  return page.evaluate(() => ({
    title: document.title,
    status: document.querySelector('#status')?.textContent ?? null,
    items: [...document.querySelectorAll('main li')].map((item) => item.textContent),
  }));
}

async function writeFruitPage(workspace: string): Promise<void> {
  const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'fruit');
  await mkdir(pageDir, { recursive: true });
  await writeFile(
    path.join(pageDir, 'index.html'),
    [
      '<head>',
      '  <title data-text="title">Fruit</title>',
      '  <script type="module" src="index.js"></script>',
      '</head>',
      '<body>',
      '  <main>',
      '    <h1 data-text="title">Fruit</h1>',
      '    <p id="status" data-text="status">Loading</p>',
      '    <input id="filter" data-attr-value="filter" />',
      '    <ul><li data-each="items as item" data-text="item">Fruit</li></ul>',
      '    <p id="empty" data-if="!items">Nothing here.</p>',
      '  </main>',
      '</body>',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(pageDir, 'data.ts'),
    [
      "import { z } from 'zod';",
      '',
      'export const data = z.object({',
      '  title: z.string(),',
      '  status: z.string(),',
      '  filter: z.string(),',
      '  items: z.array(z.string()),',
      '});',
      '',
      "export const initial = { title: 'Fruit', status: 'Loading', filter: '', items: [] };",
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(pageDir, 'index.ts'),
    [
      "const all = ['apple', 'banana', 'cherry'];",
      '',
      'export async function load() {',
      '  await new Promise((resolve) => setTimeout(resolve, 150));',
      "  return { title: 'Fruit', status: 'Loaded', filter: '', items: all };",
      '}',
      '',
      'export function setup({ root, data, render }: any): void {',
      "  root.addEventListener('input', (event: Event) => {",
      '    const input = event.target as HTMLInputElement;',
      "    if (input.id !== 'filter') return;",
      '    const filter = input.value;',
      '    render({ ...data, filter, items: all.filter((item) => item.includes(filter)) });',
      '  });',
      '}',
      '',
    ].join('\n'),
  );
}

async function writeHomeLink(workspace: string): Promise<void> {
  const home = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
  const html = await readFile(home, 'utf8');
  await writeFile(
    home,
    html.replace(
      '</main>',
      '<p><a href="/fruit/">Fruit</a> <a href="/broken/">Broken</a></p></main>',
    ),
  );
}

/** A page whose load returns data its template can't render (an object where text goes). */
async function writeBrokenPage(workspace: string): Promise<void> {
  const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'broken');
  await mkdir(pageDir, { recursive: true });
  await writeFile(
    path.join(pageDir, 'index.html'),
    '<head><title>Broken</title><script type="module" src="index.js"></script></head><body><main><p data-text="status">Loading</p></main></body>\n',
  );
  await writeFile(
    path.join(pageDir, 'data.ts'),
    "import { z } from 'zod';\nexport const data = z.object({ status: z.string() });\nexport const initial = { status: 'Loading' };\n",
  );
  await writeFile(
    path.join(pageDir, 'index.ts'),
    'export async function load() {\n  return { status: { not: "text" } };\n}\n',
  );
}

async function addDependency(workspace: string, name: string, version: string): Promise<void> {
  const file = path.join(workspace, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.dependencies = { ...manifest.dependencies, [name]: version };
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
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
      if (await file.exists()) return new Response(file);
      const indexFile = Bun.file(path.join(filePath, 'index.html'));
      if (await indexFile.exists()) return new Response(indexFile);
      return new Response('Not found', { status: 404 });
    },
  });
}
