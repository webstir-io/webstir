import type { PageSetup } from './page.js';

export interface PageLoadContext {
  readonly url: URL;
  readonly signal: AbortSignal;
}

export type PageLoad<Data = unknown> = (context: PageLoadContext) => Data | Promise<Data>;
export interface LoadablePage {
  readonly load: PageLoad;
  readonly setup?: PageSetup;
}
export interface PreparedPage {
  readonly module: LoadablePage;
  readonly data: unknown;
}

/** A superseded import or loader cannot hold up the next navigation. */
export function preparePage(
  module: Promise<LoadablePage>,
  url: string,
  signal: AbortSignal,
): Promise<PreparedPage> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException('Page load aborted', 'AbortError'));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    void module
      .then(async (page) => {
        signal.throwIfAborted();
        if (typeof page.load !== 'function')
          throw new Error('A data-webstir-load page must export load.');
        const data = await page.load({ url: new URL(url), signal });
        signal.throwIfAborted();
        return { module: page, data };
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
