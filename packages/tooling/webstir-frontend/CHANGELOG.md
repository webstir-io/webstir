# @webstir-io/webstir-frontend

## 0.4.0

### Minor Changes

- ff5d7f4: Pages can render in the browser from the same template a server renders: add a `data.ts` beside a page (its data schema and first-load `initial` data), export `load` from the page script, and Webstir checks the bindings at build time, ships the page rendered with `initial`, renders the loaded data in the browser (before the swap with client-nav), and gives `setup` a `render(data)` to update it. SPA workspaces can now use bindings on such pages. `@webstir-io/module-contract/render` exposes the dependency-free executor for the browser.
- 60d90c2: One watch pipeline and one navigation. Every workspace now watches through the same pipeline as `webstir build`, so watch shows what a build produces (the app shell, partials and `<main>`'s attributes included), and a rebuild that fails a build check keeps serving the last valid page. With client-nav on, an edit to a page's code shows the page again from the new code, in place, keeping scroll and focus; CSS edits still swap in place. New `spa` and `full` apps start with client-nav on. The unused SPA router is gone: `webstir enable spa` now points to client-nav, new apps no longer get `router.ts`, `navigation.ts` or `router-types.ts`, and `webstir repair` lists them in older apps without deleting them. The unused `--hmr-verbose` flag is removed, and `enable.spa` is no longer read or reported by `inspect`.

### Patch Changes

- Updated dependencies [ff5d7f4]
  - @webstir-io/module-contract@0.4.0

## 0.3.1

### Patch Changes

- 09e9cf3: Client-nav now brings the new page's title and metadata along (named `<meta>`, Open Graph, and canonical/alternate/prev/next links) instead of keeping the previous page's, and loads a page in full when its referrer policy differs from the one on screen.
- @webstir-io/module-contract@0.3.1
