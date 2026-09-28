import { afterAll, afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';

import { packageRoot, repoRoot } from '../src/paths.ts';
import {
  copyDemoWorkspace,
  removeDemoWorkspace,
  type DemoWorkspaceCopy,
} from '../test-support/demo-workspace.ts';
import {
  appendWatchLogs,
  collectOutput,
  getFreePort,
  removeTrackedChild,
  settleOutputDrains,
  stopSpawnedProcess,
  stopTrackedChildren,
  waitFor,
  waitForWatchReady,
} from '../test-support/watch.ts';

const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];
let sharedBrowser: Browser | undefined;

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
});

afterAll(async () => {
  await sharedBrowser?.close();
});

test('SPA watch serves distinct HTML for non-home pages', async () => {
  await withSpaWatch('webstir-spa-watch-pages-', {
    prepare: (workspace) => addPage(workspace, 'about'),
    run: async ({ fetchText }) => {
      await waitFor(async () => {
        const homeHtml = await fetchText('/');
        const aboutHtml = await fetchText('/about');
        expect(homeHtml).toContain('<title>Home</title>');
        expect(aboutHtml).toContain('<title>about</title>');
        expect(aboutHtml).toContain('Content for the about page.');
      }, 30_000);
    },
  });
}, 120_000);

test('SPA watch serves a page at the dynamic paths its views declare', async () => {
  await withSpaWatch('webstir-spa-watch-views-', {
    prepare: async (workspace) => {
      await addPage(workspace, 'about');
      const packageJsonPath = path.join(workspace, 'package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
        webstir?: Record<string, unknown>;
      };
      packageJson.webstir = {
        ...packageJson.webstir,
        moduleManifest: {
          views: [
            { name: 'thing', path: '/things/:thing', page: 'about', renderMode: 'spa' },
            { name: 'thing-detail', path: '/things/:thing/:detail', page: 'about' },
          ],
        },
      };
      await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    },
    run: async ({ port }) => {
      await waitFor(async () => {
        const [about, thing, detail, tooDeep] = await Promise.all([
          fetch(`http://127.0.0.1:${port}/about`),
          fetch(`http://127.0.0.1:${port}/things/alpha`),
          fetch(`http://127.0.0.1:${port}/things/alpha/beta/`),
          fetch(`http://127.0.0.1:${port}/things/alpha/beta/gamma`),
        ]);
        expect(about.status).toBe(200);
        expect(thing.status).toBe(200);
        expect(await thing.text()).toContain('Content for the about page.');
        expect(detail.status).toBe(200);
        expect(await detail.text()).toContain('Content for the about page.');
        expect(tooDeep.status).toBe(404);
      }, 30_000);
    },
  });
}, 120_000);

test('SPA watch shows the page again from edited page code, in place, through client-nav', async () => {
  const pageScript = (version: string) =>
    [
      "import type { PageContext } from '@webstir-io/webstir-frontend/runtime';",
      '',
      'type Log = Window & { __setups?: string[]; __cleanups?: string[] };',
      '',
      'export function setup({ root, scope }: PageContext): void {',
      `  root.dataset.version = '${version}';`,
      `  ((window as Log).__setups ??= []).push('${version}');`,
      `  scope.add(() => ((window as Log).__cleanups ??= []).push('${version}'));`,
      '}',
      '',
    ].join('\n');

  await withSpaWatch('webstir-spa-watch-refresh-', {
    prepare: async (workspace) => {
      const home = path.join(workspace, 'src', 'frontend', 'pages', 'home');
      await writeFile(path.join(home, 'index.ts'), pageScript('v1'), 'utf8');
      const html = await readFile(path.join(home, 'index.html'), 'utf8');
      await writeFile(
        path.join(home, 'index.html'),
        html.replace(
          /<main>[\s\S]*<\/main>/,
          '<main>\n        <input id="query" />\n        <div style="height: 4000px"></div>\n    </main>',
        ),
        'utf8',
      );
    },
    run: async ({ workspace, port }) => {
      const page = await openPage(port);
      await page.waitForSelector('html[data-webstir-ready] main[data-version="v1"]');
      await page.focus('#query');
      await page.evaluate(() => {
        (window as Window & { __marker?: string }).__marker = 'kept';
        window.scrollTo({ top: 1200, behavior: 'instant' });
      });
      expect(await page.evaluate(() => window.scrollY)).toBe(1200);

      await writeFile(
        path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.ts'),
        pageScript('v2'),
        'utf8',
      );

      await page.waitForSelector('html[data-webstir-ready] main[data-version="v2"]', {
        timeout: 20_000,
      });
      const state = await page.evaluate(() => {
        const log = window as Window & {
          __marker?: string;
          __setups?: string[];
          __cleanups?: string[];
        };
        return {
          marker: log.__marker,
          setups: log.__setups,
          cleanups: log.__cleanups,
          scrollY: window.scrollY,
          focused: document.activeElement?.id,
        };
      });
      expect(state).toEqual({
        marker: 'kept',
        setups: ['v1', 'v2'],
        cleanups: ['v1'],
        scrollY: 1200,
        focused: 'query',
      });
    },
  });
}, 120_000);

test('SPA watch hot-applies CSS edits without a full page reload', async () => {
  await withSpaWatch('webstir-spa-watch-css-', {
    run: async ({ workspace, port }) => {
      const page = await openPage(port);
      await page.waitForSelector('html[data-webstir-ready]');
      await page.evaluate(() => {
        (window as Window & { __marker?: string }).__marker = 'kept';
      });
      const stylesheetPath = path.join(workspace, 'src', 'frontend', 'app', 'app.css');
      await writeFile(
        stylesheetPath,
        `${await readFile(stylesheetPath, 'utf8')}\nbody { background: rgb(255, 0, 0); }\n`,
        'utf8',
      );

      await page.waitForFunction(
        () => getComputedStyle(document.body).backgroundColor === 'rgb(255, 0, 0)',
        undefined,
        { timeout: 20_000 },
      );
      expect(await page.evaluate(() => (window as Window & { __marker?: string }).__marker)).toBe(
        'kept',
      );
    },
  });
}, 120_000);

test('SPA watch inlines data-webstir-inline scripts and regenerates when their sources change', async () => {
  let paintPath = '';
  await withSpaWatch('webstir-spa-watch-inline-', {
    prepare: async (workspace) => {
      const appDir = path.join(workspace, 'src', 'frontend', 'app');
      const scriptsDir = path.join(appDir, 'scripts');
      await mkdir(scriptsDir, { recursive: true });
      paintPath = path.join(scriptsDir, 'paint.ts');
      await writeFile(
        paintPath,
        "export const firstPaintVersion = 'paint-v1';\ndocument.documentElement.dataset.firstPaint = firstPaintVersion;\n",
        'utf8',
      );
      await writeFile(path.join(scriptsDir, 'first-paint.ts'), "import './paint.js';\n", 'utf8');
      const appHtmlPath = path.join(appDir, 'app.html');
      const appHtml = await readFile(appHtmlPath, 'utf8');
      await writeFile(
        appHtmlPath,
        appHtml.replace(
          '<head>',
          '<head>\n    <script data-webstir-inline src="./scripts/first-paint.ts"></script>',
        ),
        'utf8',
      );
    },
    run: async ({ fetchText }) => {
      await waitFor(async () => {
        const html = await fetchText('/');
        expect(html).toContain('paint-v1');
        expect(html).not.toMatch(/data-webstir-inline[^>]*src=/);
      }, 30_000);

      // The tag's own source did not change; a file it imports did.
      await writeFile(
        paintPath,
        (await readFile(paintPath, 'utf8')).replace('paint-v1', 'paint-v2'),
        'utf8',
      );
      await waitFor(async () => {
        const html = await fetchText('/');
        expect(html).toContain('paint-v2');
        expect(html).not.toContain('paint-v1');
      }, 30_000);
    },
  });
}, 120_000);

test('SPA watch keeps the last valid page when an edit adds a binding', async () => {
  await withSpaWatch('webstir-spa-watch-bindings-', {
    run: async ({ workspace, fetchText, stderr }) => {
      const pagePath = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
      const original = await readFile(pagePath, 'utf8');
      await writeFile(
        pagePath,
        original.replace(/<main([^>]*)>/, '<main$1><p data-text="greeting">binding-v2</p>'),
        'utf8',
      );
      await waitFor(async () => {
        expect(stderr()).toContain(
          "page 'home' has bindings, but an SPA has no server to render them",
        );
      }, 30_000);
      expect(await fetchText('/')).not.toContain('binding-v2');

      await writeFile(
        pagePath,
        original.replace(/<main([^>]*)>/, '<main$1><p>plain-v3</p>'),
        'utf8',
      );
      await waitFor(async () => {
        expect(await fetchText('/')).toContain('plain-v3');
      }, 30_000);
    },
  });
}, 120_000);

test('SPA watch rebuilds transitive CSS imports and follows a newly added one', async () => {
  let paths = { appCss: '', appCssSource: '', second: '', added: '' };
  await withSpaWatch('webstir-spa-watch-css-graph-', {
    prepare: async (workspace) => {
      const appRoot = path.join(workspace, 'src', 'frontend', 'app');
      const stylesRoot = path.join(appRoot, 'styles');
      paths = {
        appCss: path.join(appRoot, 'app.css'),
        appCssSource: await readFile(path.join(appRoot, 'app.css'), 'utf8'),
        second: path.join(stylesRoot, 'watch-second.css'),
        added: path.join(stylesRoot, 'watch-added.css'),
      };
      await mkdir(stylesRoot, { recursive: true });
      await Promise.all([
        writeFile(
          paths.appCss,
          `@import "./styles/watch-first.css";\n${paths.appCssSource}`,
          'utf8',
        ),
        writeFile(
          path.join(stylesRoot, 'watch-first.css'),
          '@import "./watch-second.css";\n',
          'utf8',
        ),
        writeFile(paths.second, ':root { --watch-state: nested-before; }\n', 'utf8'),
      ]);
    },
    run: async ({ fetchText }) => {
      // Watch serves app styles unbundled, so this follows the imports as the browser does.
      const servedCss = async (url = '/app/app.css'): Promise<string> => {
        const css = await fetchText(url);
        const imports = [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map(
          (match) => new URL(match[1]!, `http://localhost${url}`),
        );
        const nested = await Promise.all(
          imports.map((target) => servedCss(`${target.pathname}${target.search}`)),
        );
        return [css, ...nested].join('\n');
      };

      await waitFor(async () => {
        expect(await servedCss()).toContain('--watch-state: nested-before');
      }, 30_000);
      await writeFile(paths.second, ':root { --watch-state: nested-after; }\n', 'utf8');
      await waitFor(async () => {
        expect(await servedCss()).toContain('--watch-state: nested-after');
      }, 20_000);

      await writeFile(paths.added, ':root { --watch-added: added-before; }\n', 'utf8');
      await writeFile(
        paths.appCss,
        `@import "./styles/watch-added.css";\n@import "./styles/watch-first.css";\n${paths.appCssSource}`,
        'utf8',
      );
      await waitFor(async () => {
        expect(await servedCss()).toContain('--watch-added: added-before');
      }, 20_000);

      await writeFile(paths.added, ':root { --watch-added: added-after; }\n', 'utf8');
      await waitFor(async () => {
        expect(await servedCss()).toContain('--watch-added: added-after');
      }, 20_000);
    },
  });
}, 120_000);

interface SpaWatch {
  readonly workspace: string;
  readonly port: number;
  fetchText(requestPath: string): Promise<string>;
  stderr(): string;
}

async function withSpaWatch(
  prefix: string,
  options: {
    readonly prepare?: (workspace: string) => Promise<void>;
    readonly run: (watch: SpaWatch) => Promise<void>;
  },
): Promise<void> {
  const copy: DemoWorkspaceCopy = await copyDemoWorkspace('spa', prefix);
  const workspace = copy.workspaceRoot;
  await options.prepare?.(workspace);
  const port = await getFreePort();
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
  const stdout = { text: '' };
  const stderr = { text: '' };
  const drains = [collectOutput(child.stdout, stdout), collectOutput(child.stderr, stderr)];

  try {
    await waitForWatchReady(stdout, 30_000);
    await options.run({
      workspace,
      port,
      fetchText: async (requestPath) => {
        const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
        if (!response.ok) throw new Error(`Unexpected status: ${response.status}`);
        return await response.text();
      },
      stderr: () => stderr.text,
    });
  } catch (error) {
    throw appendWatchLogs(error, stdout.text, stderr.text);
  } finally {
    await stopSpawnedProcess(child);
    await settleOutputDrains(...drains);
    removeTrackedChild(childProcesses, child);
    await removeDemoWorkspace(copy);
  }
}

async function addPage(workspace: string, name: string): Promise<void> {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'add-page',
      name,
      '--workspace',
      workspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(result.exitCode).toBe(0);
}

async function openPage(port: number): Promise<Page> {
  sharedBrowser ??= await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await sharedBrowser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      (window as Window & { __webstirEventSource?: EventSource }).__webstirEventSource
        ?.readyState === EventSource.OPEN,
    undefined,
    { timeout: 15_000 },
  );
  return page;
}
