# Plan: one pipeline, one navigation

Step 2 of making Webstir the framework you can pick for any web app. Step 1 made every page one kind of page, rendering at build, per request or in the browser. This step removes the parallel systems around it: every workspace builds and watches through one pipeline, and client-nav is the only navigation.

## What's there today

- **Two watch pipelines.** Each is chosen once, at startup.
  - The **Bun-first** pipeline (Bun's HTML bundler) runs only for SPA workspaces without client-nav, and for fresh full-mode apps without client-nav or server views.
  - Everything else uses the **document builder**: every SSG workspace, the portal, and every demo with client-nav.
- **The document builder already does more** than Bun-first:
  - client error reporting, and SSE build status
  - the app shell and partials in watch
  - proxying non-GET requests to the backend
  - the client-nav redirect header
  - static folders, content, search and hooks
- **What only Bun-first has:**
  - hot-swapping page JavaScript while keeping page state (through Bun's dev client, used only by two demos)
  - keeping the last valid page when an SPA edit adds a binding (the document builder checks this only on a full build, not on a watch rebuild)
  - a faster start, since it skips the initial build (not measured)
- **Watch output differs from build output.** Bun-first drops the app shell outside `<main>`, partials and `<main>`'s attributes in watch.
- **The SPA router is dead code:** exact-path handlers with no rendering. Nothing calls it, but `init` scaffolds it into every SPA and full app, and `enable spa` copies it in.
- **New full-mode apps don't enable client-nav,** so the template's own `/lifecycle` page (which needs client-nav's `setup`) doesn't work out of the box.

## What changes

1. **Every workspace watches through the document builder.**
   - The Bun-first pipeline is removed: `bun-generated-frontend-watch.ts`, `bun-spa-document.ts`, `bun-spa-routes.ts`, `bun-spa-watch.ts`, and the `.webstir/bun-first-spa` output.
   - `spa` and `full` watch start the same way `ssg` does. Watch output then matches build output.
2. **Close the one guarantee only Bun-first had.** A watch rebuild runs the same template checks as a full build: SPA bindings, and browser-page rules from step 1. When they fail, it keeps serving the last valid page and reports the error, as server views already do.
3. **JavaScript edits update the page in place, through client-nav; CSS edits still hot-swap.**
   - When a page script changes, the watch client has client-nav re-fetch the current page. The old page's cleanup runs, then the new code's `setup` runs, and the result swaps into `<main>`. Scroll, the app shell and anything outside `<main>` stay; there's no reload flash.
   - Without client-nav, the page reloads.
   - This replaces Bun's module-level hot swap, which only the SPA and full demos used (`import.meta.hot`). Those demo lines go. A page comes back in the state its `load` and `setup` describe, not with leftover module variables.
4. **Client-nav is the navigation.**
   - The SPA router is removed: `router.ts`, `navigation.ts`, `router-types.ts`, the `features/router` copy, and `enable spa`.
   - `webstir enable spa` stops with a message pointing to client-nav.
   - `repair` never deletes the old files in existing apps; it lists them as removable.
5. **New SPA and full apps start with client-nav on,** so pages get `setup`/`load`, browser rendering and the lifecycle page works as scaffolded.
6. **Cleanup:**
   - remove the unused `--hmr-verbose` flag
   - pass `--verbose` to every watch mode, not just SSG
   - remove `scripts/check-full-demo-sync.mjs`'s allowance for demo-only HMR code

## What stays

- The workspace modes and what they really control:
  - whether there's a backend
  - the SSG publish layout
  - whether a server is deployed

  Collapsing modes into opt-in layers is a later step.
- Every behavior of the document builder, and publish output (unchanged).

## Tests and docs

- **Tests:**
  - Remove the Bun-first tests, after porting the scenarios the document builder isn't already tested for:
    - inline-script edits regenerate
    - a transitive CSS `@import` hot-swaps
    - a binding edit keeps the last valid page
    - view path parameters route
  - Point the SPA demo's watch and runtime tests at the document builder.
  - Update the init, repair and enable tests for the router removal and for client-nav on by default.
- **Docs:**
  - Rewrite **Watch**, **Frontend Watch** and **HMR Validation** for one pipeline.
  - Update:
    - **Enable** (no `enable spa`)
    - the **CLI** reference
    - the **Templates** reference
    - the engine and services explanations
    - the client-nav lifecycle guide
    - the orchestrator and frontend READMEs
    - the `watch:spa` script

## Delivery

One PR. The navigation and pipeline changes can't be split: turning client-nav on for new apps moves them off Bun-first. Most of the diff is deletion. It carries a changeset. Together they release as **Webstir 0.5.0**, a minor version because `enable spa` goes away and SPA watch behaves differently. With auto-release, that publishes once the layers merge; the publish is the one irreversible step.

## Decisions (defaults chosen; say if you want otherwise)

- **JavaScript edits update the page in place through client-nav,** re-running the page's lifecycle instead of swapping modules. One pipeline, predictable behavior.
- **`enable spa` is removed, not kept as an alias.** It installs code nothing uses.
- **Client-nav is on by default for new SPA and full apps.** Existing apps are unchanged.

## As built (changes from this plan)

- **The watch session is `document-watch.ts`** (was `bun-ssg-watch.ts`), since it now serves every frontend mode.
- **Page refresh** is a `pageRefresh` hot update: page code changes send it with `requiresReload`, so an app whose `hmr.js` predates it, or has no client-nav, reloads as before. Client-nav's `refreshPage` re-imports page scripts under a new version, so the browser runs the new code once.
- **`repair` upgrades existing `hmr.js` clients.** The client Webstir shipped from 0.1.59 to 0.4 counts as Webstir's own, so repair replaces it rather than calling it customized.
- **The SPA template's home page uses `setup`,** as the full template's does, instead of a `registerHotModule` demo. The registry itself stays for modules that opt in; in `ssg` workspaces, docs page and `_sidebar.json` edits still re-import the docs module instead of refreshing.
- **The demo "home boundary" tests are gone,** with the Bun-only demo code they exercised. The SPA watch suite proves the refresh instead: the old cleanup runs, the new setup runs, and scroll, focus and page state stay. The remaining boundary tests no longer start watch or a browser, so they run with the core tests.
- **`enable.spa` is no longer read,** and `inspect` no longer reports it.
