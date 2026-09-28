import { executeRenderProgram } from '@webstir-io/module-contract/render';
import type { RenderProgram } from '@webstir-io/module-contract';
import type { LoadablePage } from './page-load.js';

/** The export a browser-rendered page's bundle carries its compiled template in. */
export const BROWSER_PROGRAM_EXPORT = '__webstirRenderProgram';

/** The render program a page module carries, when the page renders in the browser. */
export function browserProgramOf(module: unknown): RenderProgram | undefined {
  const program = (module as Record<string, unknown> | null)?.[BROWSER_PROGRAM_EXPORT];
  return program && typeof program === 'object' ? (program as RenderProgram) : undefined;
}

/**
 * Renders the page's template with `data` and puts the result where the page shows it: the
 * `<main>` and `<title>` of `target`, which is the live document or one about to replace it.
 * Escaping is the server's, since it is the same executor.
 */
export function renderPageInto(target: Document, program: RenderProgram, data: unknown): void {
  const rendered = new DOMParser().parseFromString(
    executeRenderProgram(program, data, { csrfToken: false }),
    'text/html',
  );
  const next = rendered.querySelector('main');
  const main = target.querySelector('main');
  if (next && main) {
    main.innerHTML = next.innerHTML;
  }
  const title = rendered.querySelector('title');
  if (title) {
    target.title = title.textContent ?? '';
  }
}

/**
 * Renders the live page again with new data, keeping focus on the same control when it is still
 * there (matched by id, then by name).
 */
export function rerenderPage(program: RenderProgram, data: unknown): void {
  const active = document.activeElement;
  const main = document.querySelector('main');
  const within = active instanceof HTMLElement && main?.contains(active) ? active : null;
  const key = within?.id
    ? `#${CSS.escape(within.id)}`
    : within?.getAttribute('name')
      ? `[name="${CSS.escape(within.getAttribute('name')!)}"]`
      : null;
  const selection =
    within instanceof HTMLInputElement || within instanceof HTMLTextAreaElement
      ? readSelection(within)
      : null;

  renderPageInto(document, program, data);

  if (!key) return;
  const again = document.querySelector('main')?.querySelector<HTMLElement>(key);
  if (!again) return;
  again.focus({ preventScroll: true });
  if (selection && (again instanceof HTMLInputElement || again instanceof HTMLTextAreaElement)) {
    try {
      again.setSelectionRange(selection.start, selection.end);
    } catch {
      // Input types without a selection (e.g. number) keep the default caret.
    }
  }
}

function readSelection(
  element: HTMLInputElement | HTMLTextAreaElement,
): { start: number; end: number } | null {
  try {
    return element.selectionStart === null
      ? null
      : { start: element.selectionStart, end: element.selectionEnd ?? element.selectionStart };
  } catch {
    return null;
  }
}

const CLIENT_NAV = Symbol.for('webstir.client-nav');

/** Client-nav marks the page it runs in, so a browser page's own first-load boot stands aside. */
export function markClientNav(): void {
  (globalThis as Record<symbol, unknown>)[CLIENT_NAV] = true;
}

/**
 * The first load of a browser-rendered page without client-nav: load the data, render it, then
 * set the page up. With client-nav, client-nav does all of this, on first load and after every
 * navigation, so this does nothing.
 */
export function bootBrowserPage(module: Partial<LoadablePage> & Record<string, unknown>): void {
  const program = browserProgramOf(module);
  if (!program) return;
  const start = async () => {
    if ((globalThis as Record<symbol, unknown>)[CLIENT_NAV]) return;
    if (typeof module.load !== 'function') {
      throw new Error('A page with a data.ts must export load from its script.');
    }
    const { createPageLifecycle } = await import('./page.js');
    const url = window.location.href;
    const controller = new AbortController();
    const data = await module.load({ url: new URL(url), signal: controller.signal });
    renderPageInto(document, program, data);
    const root = document.querySelector('main');
    if (root && typeof module.setup === 'function') {
      await createPageLifecycle().start(module.setup, root, url, data, (next) =>
        rerenderPage(program, next),
      );
    }
    document.documentElement.setAttribute('data-webstir-ready', '');
  };
  // Every module script in the document runs before DOMContentLoaded (they run while the document
  // is `interactive`), so by then client-nav, wherever its script sits, has marked the page.
  if (document.readyState !== 'complete') {
    document.addEventListener('DOMContentLoaded', () => void start().catch(console.error), {
      once: true,
    });
  } else {
    void start().catch(console.error);
  }
}
