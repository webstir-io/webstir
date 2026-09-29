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
2. Synchronize styles, update history, title and page metadata, replace `<main>`, and restore focus/scroll.
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
The framework does not decide authentication policy.

## What follows the page in `<head>`

Client-nav keeps the document it started in and brings the parts of the new
page's `<head>` that describe that page:

- **Title:** the new page's `<title>`, empty if it has none.
- **Styles:** the new page's stylesheets load before the swap and the old page's
  are removed after it; `app.css` stays. `<style data-critical>` is replaced.
- **Scripts:** the old page's entry script goes, and the new page's head scripts
  load after the swap. The client-nav script and, in `watch`, Webstir's dev clients stay.
- **Page metadata:** every `<meta name>` except `viewport` and `referrer`, every
  `<meta property>` (Open Graph), and `<link>`s whose rel is only `canonical`,
  `alternate`, `prev` or `next`. The old page's are removed and the new page's
  added in its order, with relative `href`s resolved against the new page's
  address and `<base>`, so a page that lacks a `description`, `robots`,
  `theme-color` or canonical does not inherit the previous page's. A link whose
  `href` is not `http:` or `https:` is left out.
- **Address:** it changes just before the new `<main>` goes in, so the new
  content's relative URLs, and the `Referer` its requests send, are the new
  page's.

Everything else stays as the first load left it: `charset`, `viewport`,
`http-equiv` (a Content-Security-Policy included), `<base>`, icons, the manifest,
preloads and inline head scripts. A page that needs a different one of those
should opt its links out with `data-client-nav="off"` so it loads in full.

## When client-nav loads a page in full

The referrer policy never changes in place: a browser cannot undo a policy once a
referrer meta has set it. So when the new page would get a different policy than
the page on screen, client-nav loads its address in full and the browser applies
the policy itself. A page's policy is its last valid `<meta name="referrer">`
(anywhere, `<main>` included), else its `Referrer-Policy` header. Pages that set
none, or the same one, stay client-side, and keep that policy even after the meta
that set it leaves with `<main>`. This covers links, Back and Forward, redirects
and forms.

Loading in full fetches the page again, and a response is only used once, so
client-nav avoids spending one on a page it then throws away:

- A redirect followed from a page that sets a policy loads its destination in
  full without fetching it first, so a message the destination shows once (a
  flash) is still there.
- A form answered with a page whose policy differs: a re-rendered form (`422`) is
  posted again natively, if the form still holds what it sent, which re-runs only
  the refused check and shows its errors and values at the form's action address,
  as a browser without JavaScript would. Any other answer may follow a change the
  action made, so it is not posted twice: its address loads.

A page with another policy reached by a link, Back or Forward is fetched once to
read its policy, then loaded; a message it would show once is spent on that
first fetch.

A page that sets `no-referrer` to keep a token in its address out of `Referer`
does so only while it is on screen: leaving it for a page without that policy is
a full load. Client-nav reads the new page's policy from the response before
parsing it, so a looser policy never reaches the page on screen first. A referrer
meta it cannot read for certain (one written with character references, say)
also means a full load. A script cannot read the first page's own
`Referrer-Policy` header, so client-nav takes it to be the same as the next
page's, as a site-wide header would be.

## Redirects keep their destination

A fetch that follows a redirect cannot see where it went, so a destination's
`#fragment` would be lost. Client-nav asks the backend to answer a redirect with
`204` and the destination in `x-webstir-location` instead, then navigates there
itself: a same-origin destination renders like any client visit and scrolls to
its `#section`; another origin loads in full. Only `http:` and `https:`
destinations are followed. A redirect reached from Back or Forward replaces that
history entry, as the browser would. This covers form actions and view loaders
that `redirect()`, including auth redirects. A request without client-nav still
gets a normal redirect.

## Submitting a form twice

Each enhanced post carries a submission id. Clicking submit again while the
first post is still in flight sends the same id, unless the form changed in
between; if the post fails before a response arrives, client-nav falls back to a
normal post with the same id. The backend remembers where each submission's
action redirected (per session, the last 20), and a copy that arrives while the
first is still running waits for its answer, so the same submission gets one
answer instead of running the action again. Only a `301`, `302` or `303` that
reports no errors ends a submission: a failed check, a re-rendered form or a
`307`/`308` is not remembered, so correcting and resubmitting runs again.

A post that moves the browser off its session (signing in renews it; signing out
ends it) records its answer on the new session, if any, which a copy still
carrying the old cookie cannot reach. So the backend also keeps that answer, with
the session cookie the first response set, under the old session's id for one
minute. A copy signed with that old cookie gets the same redirect and the same
cookie, whether it waited on the first or came after it, even once the browser
has used the new session. A double click or a lost response still ends signed in
(or out), and the action runs once. The id alone is never enough: another
session, or a forged cookie, sending the same id runs as a new submission and
gets none of the first one's session. Only a post that arrived with a live
session is kept this way: one whose session had already ended (it expired, say)
is not, and a post with no session cookie at all is not deduplicated, since
nothing but its id ties a resend to the browser that sent it. The kept answer
lives in the server process's memory, so behind several processes a copy that
reaches another one runs again.

## Waiting for a page to be ready

`<html data-webstir-ready>` appears once the page's own script has run its
setup, async setup included, on first load and after every client navigation.
Client-nav removes it when a navigation starts. That is the one signal to wait
on, in tests and in code:

```ts
await page.locator('html[data-webstir-ready]').waitFor({ state: 'attached' });
```

While a navigation is in flight, `<html>` also carries `aria-busy="true"`, so
assistive technology knows the page is changing.

Prefer behavior that needs no waiting at all: attach handlers for controls the
server renders once, at the document level, keyed on data attributes, instead of
in each page's setup. They then work the moment a page appears.

## Migration

This API requires Webstir CLI and frontend 0.1.54 or newer. Update both together,
preserving their existing dependency placement, then refresh the feature files:

```sh
webstir enable client-nav --workspace "$PWD"
webstir build --workspace "$PWD"
```

From 0.3.0, `enable client-nav` imports the feature from `@webstir-io/webstir-frontend`
instead of copying files; copies an older version wrote are removed unless you edited
them, in which case the command says how to move your changes over. Rebuild and
publish the application through its normal process so generated page script tags
carry `data-webstir-page` and production asset URLs remain fingerprinted. Do not
add cache-busting imports. Custom server HTML that bypasses Webstir's HTML builder
must mark its one page entry script with `data-webstir-page` itself.

Move page DOM queries, state, listeners, observers, timers, requests, and redirects
from module top level into setup. Remove that page's previous self-initialization
and client-nav reinitialization handler to avoid double setup. Existing event-only
pages can remain unchanged. Do not import the app entry from page entries: app
initialization belongs to the shared app bundle. In watch, an edit to a page's
code shows the page again from the new code, in place: its cleanup runs, then the
new `load` and `setup`, while scroll, focus and the app shell stay. So a page comes
back in the state `load` and `setup` describe, not with values left in module
variables.

Islands, components from other libraries placed with `data-island` (see [Islands](./islands.md)), follow the same lifecycle: a page's islands unmount when client-nav leaves it and mount after its `setup`.

The website-style event rebind pattern remains valid. A portal that uses only
module top-level initialization needs this migration before adopting client-nav;
its application data, menus, error display, and auth redirects remain its code.

The full demo (`examples/demos/full`) includes `/lifecycle`, an interactive counter with
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
