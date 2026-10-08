# @webstir-io/webstir-frontend

## 0.10.0

### Minor Changes

- 5879a1e: Templates can give a path or text a name. `data-with-<name>="path"` names a path on an element and inside it, so one partial serves different data: `<div data-include="field" data-with-field="form.email"></div>`. `data-with-<name>="'text'"` names text written in the template, which the build writes into the page. Both are settled at build time, checked against the view's schema like any other path, and leave the server's program format unchanged. A schema error on such a path names the real path it read. A page that gave names and has nothing left to render but a form's CSRF field is written as what it compiled to.

### Patch Changes

- @webstir-io/module-contract@0.10.0

## 0.9.4

### Patch Changes

- 794bda0: Client navigation gives the body the incoming page's attributes and classes (keeping what scripts added) and starts each page at its top instantly, as a full load does; a page's `<body>` attributes other than `class` now reach the built page.
- Updated dependencies [794bda0]
  - @webstir-io/module-contract@0.9.4

## 0.9.3

### Patch Changes

- bac9179: `webstir watch` and `webstir build` carry an app's own imports into the backend's server entry, jobs and TypeScript migrations, as publish does, so an app whose backend files import each other starts in development. `webstir snapshot` copies the database as it is, without applying pending migrations.
- Updated dependencies [bac9179]
  - @webstir-io/module-contract@0.9.3

## 0.9.2

### Patch Changes

- 8b89099: Client navigation keeps the outgoing page's inlined styles until the next page replaces it, so a page whose small stylesheet is inlined no longer flashes unstyled while the next page's stylesheet loads.
- Updated dependencies [8b89099]
  - @webstir-io/module-contract@0.9.2

## 0.9.1

### Patch Changes

- 1cdece9: A failed form goes back to the right form on the right page, whatever failed it:
  - Every POST form carries the page it was rendered on (`_webstir_page`), so a failure returns there without a Referer, or after an earlier failed post.
  - A form that is one of many on a page names its state with `_webstir_form`, and every failure, the runtime's token check included, goes there.
  - A posted file is kept in the form's values by its name, so a page can ask for it again. An app that spreads all of a form's values into a write now sees that name too.
  - A signed-out request for a page-shaped GET route returns to that address after signing in.
- Updated dependencies [1cdece9]
  - @webstir-io/module-contract@0.9.1

## 0.9.0

### Minor Changes

- 898ec05: What the Sqware portal built for itself is now Webstir's:
  - **Typing and forms:**
    - `ViewContext` and `ActionContext` type loaders and handlers.
    - `flashSchema`, `formStateSchema` and `formView` bind a page's messages and forms.
    - A loader returns its data without `flash`.
  - **The runtime handles declared forms** (`form: { id?, csrf }`):
    - It checks the CSRF token itself and hands the handler `ctx.form`.
    - It sends a failed form back to the page it came from.
    - A handler can end with `fieldIssue(field, message, { form?, values? })`; `isWebstirControl` and `readFormIssue` let an app's own error handling and tests see it.
  - **Submission ids:** every POST form a view renders carries one, so a resent post is answered once, with or without script.
  - **Sign-in and roles:** sign-in's `loadUser` makes `ctx.user` the app's own user (or no access), and `auth: { role }` limits a route or view to users with that role.
  - **Shell data:** a module's `shell` loader gives every page a view renders data as `shell`.
  - **Behaviors:** `data-submit-on-change`, `data-dismissable` and `data-menu-trigger` get their behavior from the app bundle when a page uses them.
  - **Files:** stored through the AWS SDK on S3, with `ifAbsent`, `metadata` and `maxBytes`, SDK credentials (profiles and roles included, and `S3_PROFILE` for storage's own), checksums, and requests that time out (`S3_TIMEOUT_MS`) and retry.
  - **GET routes outside `/api`**, such as downloads, reach the server in an app with pages.
  - **Snapshots:** `SNAPSHOT_URL` keeps copies of a SQLite database after writes, and the server takes the pending one when it stops; `webstir snapshot` takes one now.
  
  Breaking: a route that declares `form: { csrf: true }` now rejects a post without a token its session issued, before the handler runs.

### Patch Changes

- Updated dependencies [898ec05]
  - @webstir-io/module-contract@0.9.0

## 0.8.1

### Patch Changes

- 755dded: Client navigation keeps Webstir's critical page styles before the app's stylesheet, where a full page load has them, so the app's own styles still win after navigating.
- @webstir-io/module-contract@0.8.1

## 0.8.0

### Minor Changes

- 2e45fbc: Webstir's plumbing moves out of the app and into the packages. The build adds to every page what the app used to carry: the live-update and reload clients in `watch`, the app bundle (enabled features, the error reporter in an app with a server, and `app.ts` only when the app has one), and the app's styles linked ahead of the page's own, with enabled features' stylesheets included. A feature flag alone turns a feature on, `webstir.enable.clientErrors` turns error reporting off or on, and `registerHotModule` comes from `@webstir-io/webstir-frontend/runtime`. `@webstir-io/webstir-frontend/tsconfig.json` and `@webstir-io/webstir-backend/tsconfig.json` hold the compiler settings, so a fresh full app is 14 files: no `hmr.js`, `refresh.js`, `error.ts`, `app.ts`, type stubs, `base.tsconfig.json`, `src/shared/` or `Errors.*.html`, and its server is one view and one form. `webstir repair` removes the copies older versions wrote where they are unchanged and notes any the app changed. The providers' unused `getScaffoldAssets` is removed from the module contract.

### Patch Changes

- Updated dependencies [2e45fbc]
  - @webstir-io/module-contract@0.8.0

## 0.7.3

### Patch Changes

- @webstir-io/module-contract@0.7.3

## 0.7.2

### Patch Changes

- @webstir-io/module-contract@0.7.2

## 0.7.1

### Patch Changes

- @webstir-io/module-contract@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies [ce4b3a2]
  - @webstir-io/module-contract@0.7.0

## 0.6.0

### Minor Changes

- 6bb7c0c: Islands: a part of a Webstir page can be a component from React, Preact, Solid, Svelte or Vue, or plain `mount` code. An island is a file in `src/frontend/islands/`; a page places it with `data-island="<name>"`, passes it props from the page's data with the `data-props` binding (rendered on the server, at build or in the browser, escaped), and says when it loads with `data-load` (`load`, `idle`, `visible`, or `media` with `data-media`). The element's own content shows until it mounts. Islands build as one code-split bundle under `/app/islands/`, so a library ships once, and only pages with islands load them. They unmount and mount with client-nav navigations and `render(data)`, and `webstir watch` mounts an edited island again in place. The build checks island names, load strategies, `data-props` paths and that each island's library is installed, with the file and line. New `webstir add-island <name> [--react|--preact|--solid|--svelte|--vue]` scaffolds one. Render programs are now version 2 (they carry JSON attributes); rebuild to refresh them.

### Patch Changes

- Updated dependencies [6bb7c0c]
  - @webstir-io/module-contract@0.6.0

## 0.5.0

### Minor Changes

- 6e3ebf5: An app is what its files say it is: pages when it has `src/frontend/`, a server when it has `src/backend/index.ts`. `webstir.mode` is gone, and so is choosing a shape once at `init`.
  
  - **Build, watch, test, publish, inspect, doctor and repair** follow the app's files. A published deploy reads what `publish` wrote.
  - **Apps without a server** (what `spa` and `ssg` were) publish as static sites for any static host. Their pages render at publish (a view) or in the browser (a `data.ts`).
  - **Page routes on static hosts:** a view that routes an address pattern to a page (`/items/:id`) works on a static host. Publish writes the page at fixed addresses, a `_redirects` rewrite for Netlify and Cloudflare Pages, and a `404.html` that loads the routed page for GitHub Pages, S3 and the rest.
  - **One bindings check for every app:** a page with bindings needs something to render it. In watch, a rejected edit keeps the last valid page.
  - **Growing an app:** `webstir enable backend` adds a server to any app, and the new `webstir enable frontend` adds pages to a server-only app.
  - **`init` and `refresh` take a starter** (`full`, `spa`, `ssg`, `api`), which only picks the starting template.
  - **`repair`** removes `webstir.mode` and `webstir.enable.backend` from existing apps.
  - **Removed:**
    - `publish --frontend-mode`
    - the frontend package's `checkSpaTemplates` and `assertNoSpaBindings`
    - `publishMode`
  
    The frontend package CLI still accepts, and ignores, `publish -m`, so deploy scripts written by earlier versions keep working.
  - **`add-page`** makes a page with a script in every app; `--no-script` makes one without.
  - **Output and JSON** report `layers: { pages, server }` instead of `mode`.
  - **Fixed:** a dependency install that runs quietly (as `webstir agent` runs it) no longer stalls when the install prints more than a pipe holds.

### Patch Changes

- Updated dependencies [6e3ebf5]
  - @webstir-io/module-contract@0.5.0

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
