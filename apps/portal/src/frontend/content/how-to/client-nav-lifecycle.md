# Client navigation page lifecycle

Client navigation is an optional enhancement of normal document links and forms.
The `webstir:client-nav` event remains supported for application-managed setup.
For interactive pages that need a lifetime, Webstir can own setup and cleanup.

## Supported API

Enable `client-nav`, then export `setup` from `src/frontend/pages/<page>/index.ts`:

```ts
import { listen, type PageContext } from '@webstir-io/webstir-frontend/runtime';

export async function setup({ root, url, signal, scope }: PageContext) {
  const button = root.querySelector('button');
  if (button) listen(scope, button, 'click', () => console.log(url.pathname));

  const observer = new ResizeObserver(() => { /* application behavior */ });
  observer.observe(root);
  scope.add(() => observer.disconnect());

  const response = await fetch('/api/items', { signal });
  const items = await response.json();
  if (signal.aborted) return;
  // Render items into this root. Guard redirects and other global effects too.
}
```

The context contains `root: HTMLElement`, `url: URL`, `signal: AbortSignal`, and
`scope: CleanupScope`. Setup returns `void`, a cleanup function, or a promise of
either. Cleanup functions may also return promises. Existing runtime helpers
`listen`, `scheduleTimeout`, `scheduleInterval`, `trackObserver`, and
`createAbortController` all work with this scope. Prefer the context signal for
page requests; it is aborted before cleanup starts.

## Ordering and ownership

On initial load, browser scripts finish their normal initial execution and Webstir
imports the marked page module from the browser's module cache and calls setup.
There is no initial `webstir:client-nav` event, preserving its existing meaning.

For a successful document visit:

1. Abort the outgoing page signal and await its registered cleanup in reverse order.
2. Synchronize styles, replace `<main>`, update title and history, and restore focus/scroll.
3. Load incoming head scripts, then activate scripts inside `<main>`.
4. Import the page entry at its existing URL and call its setup export.
5. Emit `webstir:client-nav` with the existing `detail.url`.

The event means scripts are loaded and setup has started, not that application
requests have completed. Asynchronous setup never holds the navigation open.
Cleanup returned after its page has left runs immediately. Register resources
before awaiting: adding to an already disposed scope throws. Webstir cannot
cancel arbitrary promises or prevent application code from writing stale data;
check the signal after non-cancellable work. Setup errors are reported to the
console. Cleanup or script-loading failure falls back to a full document visit.

A cached module is evaluated once, but its setup runs for each new document,
including repeated visits, Back/Forward, query changes, and distinct routes using
the same entry. Keep per-visit state inside setup. App shell behavior remains app
code. Fragment updates keep their existing `webstir:fragment-update` event and do
not dispose or remount the whole page; applications own fragment behavior.
Native document departures keep browser lifetime semantics, including BFCache.

Ordinary links without enhancement, opt-outs, modifier clicks, non-self targets,
downloads, external links, and same-document anchors keep native behavior.
Redirected link fetches use a full navigation to the final URL, including auth
redirects. The framework does not decide authentication policy.

## Migration

This API requires Webstir CLI and frontend 0.1.54 or newer. Update both together,
preserving their existing dependency placement, then refresh the feature files:

```sh
webstir enable client-nav --workspace "$PWD"
webstir build --workspace "$PWD"
```

Review the refreshed feature files if your project customized them. Rebuild and
publish the application through its normal process so generated page script tags
carry `data-webstir-page` and production asset URLs remain fingerprinted. Do not
add cache-busting imports. Custom server HTML that bypasses Webstir's HTML builder
must mark its one page entry script with `data-webstir-page` itself.

Move page DOM queries, state, listeners, observers, timers, requests, and redirects
from module top level into setup. Remove that page's previous self-initialization
and client-nav reinitialization handler to avoid double setup. Existing event-only
pages can remain unchanged. Do not import the app entry from page entries: app
initialization belongs to the shared app bundle. When client-nav is enabled, watch uses the existing document build pipeline so
page entry exports remain independently importable; Bun HTML bundling combines
script entries. Unenhanced SPA/full workspaces retain Bun HTML watch serving.
This API does not automatically opt into hot remounts; use normal reloads unless you explicitly coordinate HMR.

The website-style event rebind pattern remains valid. A portal that uses only
module top-level initialization needs this migration before adopting client-nav;
its application data, menus, error display, and auth redirects remain its code.

The full demo and full template include `/lifecycle`, an interactive counter with
scoped listener, observer, timer, request, and guarded asynchronous completion.

## Prepare data before replacing the page

For a data-driven page, opt in on its page entry script:

```html
<script type="module" src="index.js" data-webstir-load></script>
```

Export `load` alongside `setup`. The loader receives `{ url, signal }` and returns
page data. It must not access page DOM, install listeners, or perform redirects:
it runs while the outgoing page is still visible. Keep module-level code free of
page DOM access too, because the module is imported before the swap.

```ts
import type { PageContext, PageLoadContext } from '@webstir-io/webstir-frontend/runtime';

export async function load({ url, signal }: PageLoadContext) {
  const response = await fetch(`/api/items${url.search}`, { signal });
  if (!response.ok) return { error: response.status, items: [] };
  return { items: await response.json() };
}

export function setup({ root, data, scope }: PageContext<Awaited<ReturnType<typeof load>>>) {
  // Render data synchronously, including application-owned errors or redirects.
  // Register DOM listeners and cleanup here as usual.
}
```

On link navigation, the current content, URL, and page lifetime remain intact while
`load` is pending. History traversal changes the URL immediately, as usual, but
keeps the outgoing content visible until data is ready. Webstir then synchronizes styles and commits the prepared page.
Its setup runs before additional document scripts, so prepared content can render
without an intervening loading frame. On initial load the existing HTML remains
available while data loads. Pages without the attribute retain the original
script/setup ordering and do not call a load export.

Each visit loads fresh data, including history and URLs sharing a module. A new
navigation aborts the pending loader; even a promise that ignores cancellation
cannot block subsequent navigation. Treat the signal as a cancellation boundary
and avoid external side effects in loaders. Setup owns a separate page lifetime.
There is no shared data cache. Handle expected API failures as returned data so
setup can render the destination's normal error UI or auth redirect. Unexpected
loader failures use the existing full-document fallback; initial-load failures
are reported to the console.

This opt-in API requires CLI and frontend 0.1.55 or newer. Refresh generated
client-nav features after upgrading. Async work started by setup still does not
hold navigation open; move everything required for the first rendered content
into load.
