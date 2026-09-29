# @webstir-io/module-contract

## 0.8.0

### Minor Changes

- 2e45fbc: Webstir's plumbing moves out of the app and into the packages. The build adds to every page what the app used to carry: the live-update and reload clients in `watch`, the app bundle (enabled features, the error reporter in an app with a server, and `app.ts` only when the app has one), and the app's styles linked ahead of the page's own, with enabled features' stylesheets included. A feature flag alone turns a feature on, `webstir.enable.clientErrors` turns error reporting off or on, and `registerHotModule` comes from `@webstir-io/webstir-frontend/runtime`. `@webstir-io/webstir-frontend/tsconfig.json` and `@webstir-io/webstir-backend/tsconfig.json` hold the compiler settings, so a fresh full app is 14 files: no `hmr.js`, `refresh.js`, `error.ts`, `app.ts`, type stubs, `base.tsconfig.json`, `src/shared/` or `Errors.*.html`, and its server is one view and one form. `webstir repair` removes the copies older versions wrote where they are unchanged and notes any the app changed. The providers' unused `getScaffoldAssets` is removed from the module contract.

## 0.7.3

No changes in this release.

## 0.7.2

No changes in this release.

## 0.7.1

No changes in this release.

## 0.7.0

### Minor Changes

- ce4b3a2: Batteries: a server app gets a database, migrations, durable sessions, jobs, email, file storage and email-code sign-in, with no setup.
  
  - `ctx.db` is the app's database (SQLite by default, Postgres by `DATABASE_URL`), opened on first use; migrations in `src/backend/migrations/` apply when the server starts (`webstir add-migration`, `webstir migrate`).
  - Sessions are kept in the database and survive restarts.
  - Jobs run in the server: on a schedule, or queued with `ctx.jobs.enqueue()` and retried (`webstir jobs`).
  - `ctx.email` sends over SMTP (`EMAIL_URL`), or prints to `.webstir/email.log` in development; `ctx.files` stores files on disk or in S3.
  - `webstir enable sign-in` adds email-code sign-in: `ctx.user` and `auth: 'required'` on routes and views.
  - The server loads `.env` files and checks what production needs before it listens; starters write `.env.example` and a `.gitignore`.
  
  Breaking changes:
  
  - `ctx.db` was an empty per-request object; it is now the database. Use `ctx.locals` for per-request values.
  - `prepareSessionState()` and its `commit()` return promises. A custom session store's methods may now return promises; synchronous ones still work.
  - The backend scaffold no longer ships `env.ts`, `auth/adapter.ts`, `session/*`, `db/*`, `observability/*` or the job scheduler: the package provides them. Bearer-token auth is `resolveBearerAuth` from `@webstir-io/webstir-backend/auth/bearer`.

## 0.6.0

### Minor Changes

- 6bb7c0c: Islands: a part of a Webstir page can be a component from React, Preact, Solid, Svelte or Vue, or plain `mount` code. An island is a file in `src/frontend/islands/`; a page places it with `data-island="<name>"`, passes it props from the page's data with the `data-props` binding (rendered on the server, at build or in the browser, escaped), and says when it loads with `data-load` (`load`, `idle`, `visible`, or `media` with `data-media`). The element's own content shows until it mounts. Islands build as one code-split bundle under `/app/islands/`, so a library ships once, and only pages with islands load them. They unmount and mount with client-nav navigations and `render(data)`, and `webstir watch` mounts an edited island again in place. The build checks island names, load strategies, `data-props` paths and that each island's library is installed, with the file and line. New `webstir add-island <name> [--react|--preact|--solid|--svelte|--vue]` scaffolds one. Render programs are now version 2 (they carry JSON attributes); rebuild to refresh them.

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

## 0.4.0

### Minor Changes

- ff5d7f4: Pages can render in the browser from the same template a server renders: add a `data.ts` beside a page (its data schema and first-load `initial` data), export `load` from the page script, and Webstir checks the bindings at build time, ships the page rendered with `initial`, renders the loaded data in the browser (before the swap with client-nav), and gives `setup` a `render(data)` to update it. SPA workspaces can now use bindings on such pages. `@webstir-io/module-contract/render` exposes the dependency-free executor for the browser.

## 0.3.1

No changes in this release.
