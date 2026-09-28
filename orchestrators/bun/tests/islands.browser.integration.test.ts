import { afterAll, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium, type Browser, type Page } from 'playwright';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { runWebstirOrThrow } from '../test-support/cli.ts';
import {
  copyDemoWorkspace,
  removeDemoWorkspace,
  type DemoWorkspaceCopy,
} from '../test-support/demo-workspace.ts';
import { getFreePort } from '../test-support/watch.ts';

type UnmountLog = Window & { __unmounted?: string[] };

let sharedBrowser: Browser | undefined;
afterAll(async () => {
  await sharedBrowser?.close();
});

// Each island shows which library rendered it and the props it got, and records its unmount.
const unmounted = (name: string) =>
  `((window as any).__unmounted ??= []).push(${JSON.stringify(name)})`;

const ISLANDS = {
  'react-counter.tsx': `import { useEffect } from 'react';
import './react-counter.css';
export default function Counter({ start }: { start: number }) {
  useEffect(() => () => { ${unmounted('react')}; }, []);
  return <span data-lib="react" className="react-counter">react:{start}</span>;
}
`,
  'react-counter.css': '.react-counter { color: rgb(1, 2, 3); }\n',
  'react-badge.tsx': `export default function Badge() {
  return <b data-lib="react-badge">badge</b>;
}
`,
  'svelte-counter.svelte': `<script>
  import { onDestroy } from 'svelte';
  let { start } = $props();
  onDestroy(() => { (window.__unmounted ??= []).push('svelte'); });
</script>
<span data-lib="svelte">svelte:{start}</span>
<style>span { font-weight: 700; }</style>
`,
  'vue-counter.vue': `<script setup lang="ts">
import { onUnmounted } from 'vue';
const props = defineProps<{ start: number }>();
onUnmounted(() => { ((window as any).__unmounted ??= []).push('vue'); });
</script>
<template><span data-lib="vue">vue:{{ props.start }}</span></template>
<style scoped>span { font-style: italic; }</style>
`,
  'plain-counter.ts': `export function mount(element: HTMLElement, props: { start: number }) {
  element.innerHTML = '<span data-lib="plain">plain:' + props.start + '</span>';
  return () => { ${unmounted('plain')}; };
}
`,
  'shell-clock.ts': `export function mount(element: HTMLElement) {
  element.innerHTML = '<span data-lib="shell">shell</span>';
  return () => { ${unmounted('shell')}; };
}
`,
};

test('islands from React, Svelte, Vue and plain code mount with page data, share their library, and unmount on navigation', async () => {
  await withIslandsApp(
    {
      dependencies: { react: '^19.3.0', 'react-dom': '^19.3.0', svelte: '^5.57.1', vue: '^3.5.43' },
      islands: ISLANDS,
      shell: '<div data-island="shell-clock" data-load="load"></div>',
      page: [
        '<head><title>Islands</title><script type="module" src="index.js"></script></head>',
        '<body><main>',
        ...['react-counter', 'svelte-counter', 'vue-counter', 'plain-counter'].map(
          (name) =>
            `<div data-island="${name}" data-props="counter" data-load="load"><i>wait</i></div>`,
        ),
        '<div data-island="react-badge" data-load="load"><i>wait</i></div>',
        '<a href="/">Home</a>',
        '</main></body>',
      ].join('\n'),
    },
    async ({ root, page, origin }) => {
      // Two React islands, one copy of React.
      const reactFiles = await filesContaining(
        path.join(root, 'dist', 'frontend', 'app', 'islands'),
        '__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE',
      );
      expect(reactFiles).toHaveLength(1);

      await page.goto(`${origin}/islands/`);
      // The page's load gives start 7; its first render had 1, and its islands follow the data.
      for (const lib of ['react', 'svelte', 'vue', 'plain']) {
        await page.waitForSelector(`[data-lib="${lib}"]:text("${lib}:7")`, { timeout: 15_000 });
      }
      await page.waitForSelector('[data-lib="react-badge"]');
      await page.waitForSelector('[data-lib="shell"]');
      expect(await page.locator('[data-island] i').count()).toBe(0);
      // CSS an island imports loads with it; Svelte's and Vue's own styles apply.
      expect(
        await page.evaluate(() => {
          const style = (selector: string) => getComputedStyle(document.querySelector(selector)!);
          return [
            style('[data-lib="react"]').color,
            style('[data-lib="svelte"]').fontWeight,
            style('[data-lib="vue"]').fontStyle,
          ];
        }),
      ).toEqual(['rgb(1, 2, 3)', '700', 'italic']);
      // A new build of a component replaces its styles rather than adding to them.
      const styleCount = () =>
        page.evaluate(() => document.querySelectorAll('style[data-webstir-island-style]').length);
      const before = await styleCount();
      expect(before).toBe(2);
      await page.evaluate(async () => {
        const manifest = await (await fetch('/app/islands/islands.json')).json();
        for (const name of ['svelte-counter', 'vue-counter']) {
          await import(`${manifest.islands.modules[name]}?again`);
        }
      });
      expect(await styleCount()).toBe(before);

      await page.evaluate(() => {
        (window as UnmountLog).__unmounted = [];
      });
      await page.click('main a[href="/"]');
      await page.waitForFunction(() => !document.querySelector('main [data-island]'));
      await page.waitForFunction(() => ((window as UnmountLog).__unmounted ?? []).length === 4);
      expect(
        await page.evaluate(() => [...((window as UnmountLog).__unmounted ?? [])].sort()),
      ).toEqual(['plain', 'react', 'svelte', 'vue']);
      // An island in the app shell stays across navigations.
      expect(await page.locator('[data-lib="shell"]').count()).toBe(1);
      // Coming back, the page's islands mount again with their styles.
      await page.goBack();
      await page.waitForSelector('[data-lib="react"]:text("react:7")', { timeout: 15_000 });
      expect(
        await page.evaluate(
          () => getComputedStyle(document.querySelector('[data-lib="react"]')!).color,
        ),
      ).toBe('rgb(1, 2, 3)');
    },
  );
}, 300_000);

test('an island loads when its strategy says: idle, when visible, when a media query matches', async () => {
  const plain = (lib: string) =>
    `export function mount(element: HTMLElement) { element.innerHTML = '<span data-lib="${lib}">${lib}</span>'; }\n`;
  await withIslandsApp(
    {
      islands: { 'idle.ts': plain('idle'), 'seen.ts': plain('seen'), 'wide.ts': plain('wide') },
      page: [
        '<head><title>Strategies</title></head><body><main>',
        '<div data-island="idle"></div>',
        '<div data-island="wide" data-load="media" data-media="(min-width: 2000px)"></div>',
        '<div style="height: 4000px"></div>',
        '<div data-island="seen" data-load="visible"></div>',
        '</main></body>',
      ].join('\n'),
    },
    async ({ page, origin }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(`${origin}/islands/`);
      await page.waitForSelector('[data-lib="idle"]', { timeout: 15_000 });
      await page.waitForTimeout(300);
      expect(await page.locator('[data-lib="seen"]').count()).toBe(0);
      expect(await page.locator('[data-lib="wide"]').count()).toBe(0);

      await page.locator('[data-island="seen"]').scrollIntoViewIfNeeded();
      await page.waitForSelector('[data-lib="seen"]', { timeout: 10_000 });
      await page.setViewportSize({ width: 2100, height: 720 });
      await page.waitForSelector('[data-lib="wide"]', { timeout: 10_000 });
    },
  );
}, 300_000);

for (const { library, dependencies, file, source, files } of [
  {
    library: 'preact',
    dependencies: { preact: '^10.29.8' },
    file: 'hello.tsx',
    source: `import { useEffect } from 'preact/hooks';
export default function Hello() {
  useEffect(() => () => { ${unmounted('preact')}; }, []);
  return <span data-lib="preact">preact</span>;
}
`,
  },
  {
    library: 'solid',
    dependencies: {
      'solid-js': '^1.9.15',
      'babel-preset-solid': '^1.9.15',
      '@babel/core': '^7.28.0',
      '@babel/preset-typescript': '^7.27.0',
    },
    file: 'hello.tsx',
    source: `import { onCleanup } from 'solid-js';
import Label from '../components/label';
export default function Hello() {
  onCleanup(() => { ${unmounted('solid')}; });
  return <span data-lib="solid"><Label text="solid" /></span>;
}
`,
    files: {
      // A component the island imports compiles as Solid too.
      'src/frontend/components/label.tsx':
        'export default function Label(props: { text: string }) {\n  return <b>{props.text}</b>;\n}\n',
    },
  },
]) {
  test(`a ${library} island mounts and unmounts on navigation`, async () => {
    await withIslandsApp(
      {
        dependencies,
        islands: { [file]: source },
        files,
        page: '<head><title>Islands</title></head><body><main><div data-island="hello" data-load="load"><i>wait</i></div><a href="/">Home</a></main></body>',
      },
      async ({ page, origin }) => {
        await page.goto(`${origin}/islands/`);
        await page.waitForSelector(`[data-lib="${library}"]:has-text("${library}")`, {
          timeout: 15_000,
        });
        await page.click('main a[href="/"]');
        await page.waitForFunction(
          (lib) => ((window as UnmountLog).__unmounted ?? []).includes(lib),
          library,
        );
      },
    );
  }, 300_000);
}

async function withIslandsApp(
  app: {
    readonly dependencies?: Record<string, string>;
    readonly islands: Record<string, string>;
    readonly page: string;
    readonly shell?: string;
    readonly files?: Record<string, string>;
  },
  run: (context: { root: string; page: Page; origin: string }) => Promise<void>,
): Promise<void> {
  const copy: DemoWorkspaceCopy = await copyDemoWorkspace('spa', 'webstir-islands');
  const root = copy.workspaceRoot;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const packageJsonPath = path.join(root, 'package.json');
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    packageJson.dependencies = { ...packageJson.dependencies, zod: '^3.23.8', ...app.dependencies };
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
    await materializeRepoLocalWorkspaceDependencies(root, { installStdio: 'pipe' });

    const islandsDir = path.join(root, 'src', 'frontend', 'islands');
    await mkdir(islandsDir, { recursive: true });
    for (const [file, source] of Object.entries(app.islands)) {
      await writeFile(path.join(islandsDir, file), source, 'utf8');
    }
    for (const [file, source] of Object.entries(app.files ?? {})) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), source, 'utf8');
    }
    if (app.shell) {
      const shellPath = path.join(root, 'src', 'frontend', 'app', 'app.html');
      const shell = await readFile(shellPath, 'utf8');
      await writeFile(shellPath, shell.replace('<main>', `${app.shell}\n    <main>`), 'utf8');
    }
    const pageDir = path.join(root, 'src', 'frontend', 'pages', 'islands');
    await mkdir(pageDir, { recursive: true });
    await writeFile(path.join(pageDir, 'index.html'), app.page, 'utf8');
    if (app.page.includes('data-props')) {
      await writeFile(
        path.join(pageDir, 'data.ts'),
        "import { z } from 'zod';\nexport const data = z.object({ counter: z.object({ start: z.number() }) });\nexport const initial = { counter: { start: 1 } };\n",
        'utf8',
      );
      await writeFile(
        path.join(pageDir, 'index.ts'),
        'export async function load() {\n  return { counter: { start: 7 } };\n}\n',
        'utf8',
      );
    }
    await runWebstirOrThrow(['publish', '--workspace', root], {
      env: { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    });

    const port = await getFreePort();
    server = serveStatic(path.join(root, 'dist', 'frontend'), port);
    sharedBrowser ??= await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const context = await sharedBrowser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    try {
      await run({ root, page, origin: `http://127.0.0.1:${port}` }).catch(async (error) => {
        const main = await page.evaluate(
          () =>
            `${document.head.innerHTML}\nready=${document.documentElement.hasAttribute('data-webstir-ready')}\n${document.querySelector('main')?.innerHTML ?? ''}`,
        );
        throw new Error(
          `${String(error)}\n\nmain:\n${main}\n\nbrowser errors:\n${errors.join('\n')}`,
        );
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  } finally {
    server?.stop(true);
    await removeDemoWorkspace(copy);
  }
}

async function filesContaining(root: string, text: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const file = path.join(entry.parentPath, entry.name);
    if ((await readFile(file, 'utf8')).includes(text)) found.push(file);
  }
  return found;
}

function serveStatic(root: string, port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const candidates = pathname.endsWith('/')
        ? [path.join(root, pathname, 'index.html')]
        : [path.join(root, pathname), path.join(root, pathname, 'index.html')];
      for (const candidate of candidates) {
        if (!candidate.startsWith(root)) break;
        const file = Bun.file(candidate);
        if (await file.exists()) return new Response(file);
      }
      return new Response('Not found', { status: 404 });
    },
  });
}
