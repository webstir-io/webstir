import { createCleanupScope, type CleanupHandler, type CleanupScope } from './boundary.js';

export interface PageContext<Data = unknown> {
  readonly data: Data;
  readonly root: HTMLElement;
  readonly url: URL;
  readonly signal: AbortSignal;
  readonly scope: CleanupScope;
  /**
   * Renders the page again with new data, for a page that renders in the browser (one with a
   * data.ts). It replaces `<main>`'s content, so listen on `root`, which stays.
   */
  readonly render?: (data: Data) => void;
}

// biome-ignore lint/suspicious/noConfusingVoidType: Accept callbacks typed void or Promise<void>, not only explicit undefined returns.
export type PageSetupResult = void | CleanupHandler;
export type PageSetup = (context: PageContext) => PageSetupResult | Promise<PageSetupResult>;

/** One owner per document navigator; no module registry or global page state. */
export function createPageLifecycle(reportError: (error: unknown) => void = console.error) {
  let current: { controller: AbortController; scope: CleanupScope } | undefined;

  return {
    /** Starts the page; the promise settles once its setup has finished, async setup included. */
    start(
      setup: PageSetup,
      root: HTMLElement,
      url: string,
      data?: unknown,
      render?: (data: unknown) => void,
    ): Promise<void> {
      if (current) throw new Error('Dispose the previous page before starting another.');
      const controller = new AbortController();
      const scope = createCleanupScope();
      current = { controller, scope };
      try {
        const result = setup({
          data,
          root,
          url: new URL(url),
          signal: controller.signal,
          scope,
          render: render
            ? (next) => {
                if (!controller.signal.aborted) render(next);
              }
            : undefined,
        });
        if (typeof result === 'function') {
          scope.add(result);
          return Promise.resolve();
        }
        return Promise.resolve(result)
          .then(async (cleanup) => {
            if (!cleanup) return;
            if (controller.signal.aborted) await cleanup();
            else scope.add(cleanup);
          })
          .catch(reportError);
      } catch (error) {
        reportError(error);
        return Promise.resolve();
      }
    },
    async dispose(): Promise<void> {
      const previous = current;
      current = undefined;
      if (!previous) return;
      previous.controller.abort();
      await previous.scope.dispose();
    },
  };
}
