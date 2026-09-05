import { createCleanupScope, type CleanupHandler, type CleanupScope } from './boundary.js';

export interface PageContext {
  readonly root: HTMLElement;
  readonly url: URL;
  readonly signal: AbortSignal;
  readonly scope: CleanupScope;
}

// biome-ignore lint/suspicious/noConfusingVoidType: Accept callbacks typed void or Promise<void>, not only explicit undefined returns.
export type PageSetupResult = void | CleanupHandler;
export type PageSetup = (context: PageContext) => PageSetupResult | Promise<PageSetupResult>;

/** One owner per document navigator; no module registry or global page state. */
export function createPageLifecycle(reportError: (error: unknown) => void = console.error) {
  let current: { controller: AbortController; scope: CleanupScope } | undefined;

  return {
    start(setup: PageSetup, root: HTMLElement, url: string): void {
      if (current) throw new Error('Dispose the previous page before starting another.');
      const controller = new AbortController();
      const scope = createCleanupScope();
      current = { controller, scope };
      try {
        const result = setup({ root, url: new URL(url), signal: controller.signal, scope });
        if (typeof result === 'function') {
          scope.add(result);
          return;
        }
        void Promise.resolve(result)
          .then(async (cleanup) => {
            if (!cleanup) return;
            if (controller.signal.aborted) await cleanup();
            else scope.add(cleanup);
          })
          .catch(reportError);
      } catch (error) {
        reportError(error);
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
