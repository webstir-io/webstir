/**
 * Mounts a page's islands: elements with `data-island="<name>"`, each a component from another UI
 * library, loaded when its `data-load` strategy says (`load`, `idle`, `visible`, or `media` with a
 * `data-media` query) and given its `data-props` JSON. Client-nav unmounts the islands of a page it
 * leaves and mounts those of the page it shows; without client-nav, a page's islands mount once.
 */

import { ISLANDS, islandControls, type IslandControls } from '../runtime/islands.js';

/** What an island's bundle exports: mount into the element, and return how to unmount. */
export type IslandMount = (
  element: HTMLElement,
  props: Record<string, unknown>,
  context: { readonly signal: AbortSignal },
) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;

interface MountedIsland {
  readonly name: string;
  readonly controller: AbortController;
  cleanup?: () => void | Promise<void>;
}

export function startIslands(manifest: Readonly<Record<string, string>>): IslandControls {
  const existing = islandControls();
  if (existing) return existing;

  const islands = new Map<HTMLElement, MountedIsland>();
  let version: string | null = null;
  const base = (document.documentElement.getAttribute('data-webstir-base') ?? '').replace(
    /\/+$/,
    '',
  );

  const moduleUrl = (name: string): string | undefined => {
    const url = manifest[name];
    if (!url) return undefined;
    return version ? `${base}${url}?webstir-version=${version}` : `${base}${url}`;
  };

  const mount = async (element: HTMLElement, island: MountedIsland): Promise<void> => {
    const url = moduleUrl(island.name);
    if (!url) {
      console.error(`[webstir] island "${island.name}" is not in this build.`);
      return;
    }
    try {
      const module = (await import(url)) as { default: IslandMount };
      if (island.controller.signal.aborted) return;
      const props = readProps(element);
      const cleanup = await module.default(element, props, { signal: island.controller.signal });
      if (typeof cleanup !== 'function') return;
      if (island.controller.signal.aborted) await cleanup();
      else island.cleanup = cleanup;
    } catch (error) {
      console.error(`[webstir] island "${island.name}" failed to mount.`, error);
    }
  };

  const schedule = (element: HTMLElement): void => {
    const name = element.getAttribute('data-island');
    if (!name || islands.has(element)) return;
    const island: MountedIsland = { name, controller: new AbortController() };
    islands.set(element, island);
    const { signal } = island.controller;
    const start = () => {
      if (!signal.aborted) void mount(element, island);
    };
    const strategy = element.getAttribute('data-load') ?? 'idle';
    if (strategy === 'load') {
      start();
    } else if (strategy === 'visible' && 'IntersectionObserver' in globalThis) {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          start();
        }
      });
      observer.observe(element);
      signal.addEventListener('abort', () => observer.disconnect());
    } else if (strategy === 'media') {
      const query = globalThis.matchMedia?.(element.getAttribute('data-media') ?? 'all');
      if (!query || query.matches) {
        start();
      } else {
        const onChange = () => {
          if (!query.matches) return;
          query.removeEventListener('change', onChange);
          start();
        };
        query.addEventListener('change', onChange);
        signal.addEventListener('abort', () => query.removeEventListener('change', onChange));
      }
    } else if ('requestIdleCallback' in globalThis) {
      const handle = requestIdleCallback(start);
      signal.addEventListener('abort', () => cancelIdleCallback(handle));
    } else {
      const handle = setTimeout(start, 1);
      signal.addEventListener('abort', () => clearTimeout(handle));
    }
  };

  const unmount = async (element: HTMLElement): Promise<void> => {
    const island = islands.get(element);
    if (!island) return;
    islands.delete(element);
    island.controller.abort();
    try {
      await island.cleanup?.();
    } catch (error) {
      console.error(`[webstir] island "${island.name}" failed to unmount.`, error);
    }
  };

  const controls: IslandControls = {
    mountWithin(root) {
      for (const element of root.querySelectorAll<HTMLElement>('[data-island]')) schedule(element);
    },
    async unmountWithin(root) {
      await Promise.all(
        [...islands.keys()]
          .filter((element) => element === root || (root as Node).contains(element))
          .map(unmount),
      );
    },
    async remount(name) {
      version = Date.now().toString(36);
      const elements = [...islands].filter(([, island]) => island.name === name);
      for (const [element] of elements) {
        await unmount(element);
        schedule(element);
      }
    },
  };
  (globalThis as Record<symbol, unknown>)[ISLANDS] = controls;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => controls.mountWithin(document), {
      once: true,
    });
  } else {
    controls.mountWithin(document);
  }
  return controls;
}

function readProps(element: HTMLElement): Record<string, unknown> {
  const raw = element.getAttribute('data-island-props');
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : { value: parsed };
}
