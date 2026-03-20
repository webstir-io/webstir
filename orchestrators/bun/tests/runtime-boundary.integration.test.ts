import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from 'playwright';

import { packageRoot, repoRoot } from '../src/paths.ts';
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

test('SSG shell boundary remounts cleanly and restores shell state', async () => {
  const harness = createShellHarness();
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  (globalThis as typeof globalThis & { window: unknown; document: unknown }).window = harness.window;
  (globalThis as typeof globalThis & { window: unknown; document: unknown }).document = harness.document;

  try {
    const modulePath = path.join(repoRoot, 'examples', 'demos', 'ssg', 'base', 'src', 'frontend', 'app', 'app.ts');
    const shellModule = await import(pathToFileURL(modulePath).href);
    const boundary = shellModule.appShellBoundary;

    expect(harness.window.__webstirAppShellBoundary).toBe(boundary);
    expect(harness.body.getAttribute('data-webstir-shell-mounted')).toBe('1');
    expect(harness.toggle.listenerCount('click')).toBe(1);
    expect(harness.document.listenerCount('keydown')).toBe(1);
    expect(harness.document.listenerCount('click')).toBe(1);
    expect(harness.window.listenerCount('error')).toBe(1);
    expect(harness.window.listenerCount('unhandledrejection')).toBe(1);

    harness.toggle.click();
    expect(harness.menu.classList.contains('is-open')).toBe(true);
    expect(harness.body.classList.contains('webstir-menu-open')).toBe(true);

    await boundary.unmount();
    expect(harness.body.getAttribute('data-webstir-shell-mounted')).toBeNull();
    expect(harness.toggle.listenerCount('click')).toBe(0);
    expect(harness.document.listenerCount('keydown')).toBe(0);
    expect(harness.document.listenerCount('click')).toBe(0);
    expect(harness.window.listenerCount('error')).toBe(0);
    expect(harness.window.listenerCount('unhandledrejection')).toBe(0);
    expect(harness.body.classList.contains('webstir-menu-open')).toBe(false);

    await boundary.mount(harness.body);
    expect(harness.body.getAttribute('data-webstir-shell-mounted')).not.toBeNull();
    expect(harness.toggle.listenerCount('click')).toBe(1);
    expect(harness.document.listenerCount('keydown')).toBe(1);
    expect(harness.document.listenerCount('click')).toBe(1);
    expect(harness.window.listenerCount('error')).toBe(1);
    expect(harness.window.listenerCount('unhandledrejection')).toBe(1);
    expect(harness.menu.classList.contains('is-open')).toBe(true);
    expect(harness.body.classList.contains('webstir-menu-open')).toBe(true);
    expect(harness.toggle.getAttribute('aria-expanded')).toBe('true');
  } finally {
    (globalThis as typeof globalThis & { window: unknown; document: unknown }).window = previousWindow;
    (globalThis as typeof globalThis & { window: unknown; document: unknown }).document = previousDocument;
  }
}, 120_000);

test('SPA home boundary remounts cleanly and refreshes page state', async () => {
  const workspace = path.join(repoRoot, 'examples', 'demos', 'spa');
  const port = await getFreePort();
  const { child, stderrBuffer, stderrDrain, stdoutBuffer, stdoutDrain } = spawnWatch(workspace, port);

  let browser: Browser | undefined;

  try {
    await waitFor(async () => {
      const html = await fetchText(port, '/');
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
    await page.waitForFunction(() => document.querySelector('main')?.dataset.hmrRendered === '1');
    await page.evaluate(async () => {
      const boundary = window.__webstirHomeBoundary;
      if (!boundary) {
        throw new Error('Missing home boundary.');
      }

      await boundary.unmount();
      await boundary.mount(document.querySelector('main')!);
    });

    await page.waitForFunction(() => document.querySelector('main')?.dataset.hmrRendered === '2');
    expect(await page.locator('main').textContent()).toContain('Home');

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
  }
}, 120_000);

test('copied SSG boundary helper disposes child boundaries before parent cleanup', async () => {
  const modulePath = path.join(repoRoot, 'examples', 'demos', 'ssg', 'base', 'src', 'frontend', 'app', 'boundary.ts');
  const boundaryModule = await import(pathToFileURL(modulePath).href);
  const defineBoundary = boundaryModule.defineBoundary as typeof boundaryModule.defineBoundary;
  const events: string[] = [];

  const childBoundary = defineBoundary({
    mount(root, scope) {
      events.push('child-mount');
      const button = createElement('button');
      const onClick = () => {
        events.push('child-click');
      };

      button.addEventListener('click', onClick);
      scope.add(() => {
        events.push('child-cleanup');
        button.removeEventListener('click', onClick);
      });
      root.append(button);
      return { button };
    },
    unmount(state, scope) {
      events.push('child-unmount');
      scope.add(() => {
        events.push('child-unmount-cleanup');
      });
      state.button.remove();
    }
  });

  const parentBoundary = defineBoundary({
    async mount(root, scope) {
      events.push('parent-mount');
      const childRoot = createElement('div');
      const child = await scope.mountChild(childBoundary, childRoot);

      scope.add(() => {
        events.push('parent-cleanup');
      });

      root.append(childRoot);
      return { child, childRoot };
    },
    unmount(state, scope) {
      events.push('parent-unmount');
      scope.add(() => {
        events.push('parent-unmount-cleanup');
      });
      state.childRoot.remove();
    }
  });

  const root = createElement('section');
  const state = await parentBoundary.mount(root);
  expect(state.childRoot.children[0].listenerCount('click')).toBe(1);

  await state.child.unmount();
  await state.child.mount(state.childRoot);

  expect(state.childRoot.children[0].listenerCount('click')).toBe(1);
  await parentBoundary.unmount();

  expect(events).toEqual([
    'parent-mount',
    'child-mount',
    'child-unmount',
    'child-unmount-cleanup',
    'child-cleanup',
    'child-mount',
    'child-unmount',
    'child-unmount-cleanup',
    'child-cleanup',
    'parent-unmount',
    'parent-unmount-cleanup',
    'parent-cleanup'
  ]);
}, 120_000);

function spawnWatch(workspace: string, port: number): {
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

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}

type Listener = (event: unknown) => void;

function createShellHarness(): {
  window: ShellWindow;
  document: ShellDocument;
  body: ShellElement;
  menu: ShellElement;
  toggle: ShellButton;
} {
  const windowListeners = new Map<string, Set<Listener>>();
  const documentListeners = new Map<string, Set<Listener>>();
  const body = createElement('body');
  const header = createElement('header', {
    className: 'app-header',
    rectBottom: 32,
  });
  const backdrop = createElement('div', {
    className: 'ws-drawer-backdrop',
    attributes: {
      'data-drawer': 'menu',
      'data-drawer-close': '',
      'aria-hidden': 'true',
    }
  });
  const toggle = createElement('button', { className: 'app-menu__toggle', clickable: true }) as ShellButton;
  const menu = createElement('div', {
    attributes: { 'data-app-menu': '' },
    querySelector(selector) {
      if (selector === '.app-menu__toggle') {
        return toggle;
      }
      return null;
    }
  });

  body.appendChild(header);
  body.appendChild(menu);

  const document = {
    body,
    createElement(tagName: string) {
      return createElement(tagName);
    },
    querySelector(selector: string) {
      if (selector === '[data-app-menu]') {
        return menu;
      }

      if (selector === '.app-header') {
        return header;
      }

      if (selector === '.ws-drawer-backdrop' || selector === '[data-drawer="menu"]') {
        return body.children.find((child) => child.getAttribute('data-drawer') === 'menu') ?? null;
      }

      if (selector === 'main') {
        return null;
      }

      return null;
    },
    addEventListener(type: string, listener: Listener) {
      addListener(documentListeners, type, listener);
    },
    removeEventListener(type: string, listener: Listener) {
      removeListener(documentListeners, type, listener);
    },
    listenerCount(type: string) {
      return documentListeners.get(type)?.size ?? 0;
    }
  } as ShellDocument;

  const window = {
    document,
    location: { origin: 'http://example.test' },
    addEventListener(type: string, listener: Listener) {
      addListener(windowListeners, type, listener);
    },
    removeEventListener(type: string, listener: Listener) {
      removeListener(windowListeners, type, listener);
    },
    listenerCount(type: string) {
      return windowListeners.get(type)?.size ?? 0;
    },
    matchMedia() {
      return {
        matches: true,
        addEventListener() {},
        removeEventListener() {}
      };
    }
  } as ShellWindow;

  (body as ShellElement).ownerDocument = document;
  (toggle as ShellButton).ownerDocument = document;
  (menu as ShellElement).ownerDocument = document;
  (header as ShellElement).ownerDocument = document;
  (backdrop as ShellElement).ownerDocument = document;

  body.querySelector = (selector: string) => {
    if (selector === '.ws-drawer-backdrop') {
      return body.children.find((child) => child.getAttribute('data-drawer') === 'menu') ?? null;
    }

    if (selector === '[data-drawer="menu"]') {
      return body.children.find((child) => child.getAttribute('data-drawer') === 'menu') ?? null;
    }

    if (selector === '.app-header') {
      return header;
    }

    if (selector === '[data-app-menu]') {
      return menu;
    }

    return null;
  };

  body.appendChild = (child: ShellElement) => {
    body.children.push(child);
    child.parentElement = body;
    if (child.getAttribute('data-drawer') === 'menu') {
      child.setAttribute('data-created-by-test', 'true');
    }
    return child;
  };

  body.removeChild = (child: ShellElement) => {
    body.children = body.children.filter((candidate) => candidate !== child);
    child.parentElement = null;
    return child;
  };

  menu.appendChild = (child: ShellElement) => {
    menu.children.push(child);
    child.parentElement = menu;
    return child;
  };

  menu.contains = (candidate: unknown) => candidate === toggle || candidate === menu;
  header.contains = (candidate: unknown) => candidate === header;
  backdrop.contains = (candidate: unknown) => candidate === backdrop;

  return { window, document, body, menu, toggle };
}

function createElement(
  tagName: string,
  options: {
    className?: string;
    attributes?: Record<string, string>;
    rectBottom?: number;
    clickable?: boolean;
    querySelector?: (selector: string) => ShellElement | ShellButton | null;
  } = {}
): ShellElement {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, Set<Listener>>();
  const classList = createClassList();
  const element: ShellElement = {
    tagName: tagName.toUpperCase(),
    classList,
    children: [],
    dataset: {},
    parentElement: null,
    ownerDocument: null,
    style: {
      setProperty() {}
    },
    textContent: '',
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
      if (name.startsWith('data-')) {
        const key = name
          .slice(5)
          .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
        element.dataset[key] = value;
      }
    },
    removeAttribute(name: string) {
      attributes.delete(name);
      if (name.startsWith('data-')) {
        const key = name
          .slice(5)
          .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
        delete element.dataset[key];
      }
    },
    appendChild(child: ShellElement) {
      element.children.push(child);
      child.parentElement = element;
      return child;
    },
    append(...nodes: ShellElement[]) {
      for (const node of nodes) {
        element.appendChild(node);
      }
    },
    remove() {
      if (element.parentElement) {
        if (element.parentElement.removeChild) {
          element.parentElement.removeChild(element);
          return;
        }

        element.parentElement.children = element.parentElement.children.filter((candidate) => candidate !== element);
        element.parentElement = null;
      }
    },
    querySelector(selector: string) {
      if (options.querySelector) {
        return options.querySelector(selector);
      }

      return null;
    },
    addEventListener(type: string, listener: Listener) {
      addListener(listeners, type, listener);
    },
    removeEventListener(type: string, listener: Listener) {
      removeListener(listeners, type, listener);
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    contains(candidate: unknown) {
      return candidate === element || element.children.includes(candidate as ShellElement);
    },
    click() {
      const event = { type: 'click', target: element, currentTarget: element, bubbles: true, cancelable: true };
      for (const listener of listeners.get('click') ?? []) {
        listener.call(element, event);
      }
    },
    getBoundingClientRect() {
      return {
        bottom: options.rectBottom ?? 0
      } as DOMRect;
    }
  };

  if (options.className) {
    for (const token of options.className.split(/\s+/).filter(Boolean)) {
      classList.add(token);
    }
  }

  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    element.setAttribute(name, value);
  }

  return element;
}

function createClassList(): ShellClassList {
  const tokens = new Set<string>();
  return {
    add(...values: string[]) {
      for (const value of values) {
        tokens.add(value);
      }
    },
    remove(...values: string[]) {
      for (const value of values) {
        tokens.delete(value);
      }
    },
    toggle(value: string, force?: boolean): boolean {
      if (force === true) {
        tokens.add(value);
        return true;
      }

      if (force === false) {
        tokens.delete(value);
        return false;
      }

      if (tokens.has(value)) {
        tokens.delete(value);
        return false;
      }

      tokens.add(value);
      return true;
    },
    contains(value: string): boolean {
      return tokens.has(value);
    },
    toString(): string {
      return Array.from(tokens).join(' ');
    }
  };
}

function addListener(map: Map<string, Set<Listener>>, type: string, listener: Listener): void {
  const listeners = map.get(type) ?? new Set<Listener>();
  listeners.add(listener);
  map.set(type, listeners);
}

function removeListener(map: Map<string, Set<Listener>>, type: string, listener: Listener): void {
  const listeners = map.get(type);
  if (!listeners) {
    return;
  }

  listeners.delete(listener);
}

type ShellClassList = {
  add: (...values: string[]) => void;
  remove: (...values: string[]) => void;
  toggle: (value: string, force?: boolean) => boolean;
  contains: (value: string) => boolean;
  toString: () => string;
};

type ShellElement = {
  tagName: string;
  classList: ShellClassList;
  children: ShellElement[];
  dataset: Record<string, string>;
  parentElement: ShellElement | null;
  ownerDocument: ShellDocument | null;
  style: { setProperty(name: string, value: string): void };
  textContent: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  appendChild(child: ShellElement): ShellElement;
  append(...nodes: ShellElement[]): void;
  remove(): void;
  querySelector(selector: string): ShellElement | ShellButton | null;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  listenerCount(type: string): number;
  contains(candidate: unknown): boolean;
  getBoundingClientRect(): { bottom: number };
  parentNode?: ShellElement | null;
};

type ShellButton = ShellElement & {
  click(): void;
};

type ShellDocument = {
  body: ShellElement;
  createElement(tagName: string): ShellElement;
  querySelector(selector: string): ShellElement | ShellButton | null;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  listenerCount(type: string): number;
};

type ShellWindow = {
  document: ShellDocument;
  location: { origin: string };
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  listenerCount(type: string): number;
  matchMedia(query: string): {
    matches: boolean;
    addEventListener(type: 'change', listener: Listener): void;
    removeEventListener(type: 'change', listener: Listener): void;
  };
  __webstirAppShellBoundary?: {
    mount(root: Element): Promise<unknown>;
    unmount(): Promise<void>;
  };
};
