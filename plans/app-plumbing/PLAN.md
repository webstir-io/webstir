# Plan: move plumbing out of the app

Step 3 of `plans/plan.md`. An app is its pages, its backend and its styles. Today a fresh full app is 31 files, and about half of them are Webstir's machinery, copied into the app where it drifts: the dev clients, the error reporter, the app entry's registry, type stubs, config and dead files. They move into the package. What an app keeps is what it would change: its shell, its styles, its pages and its server code.

## What's there today

A fresh `webstir init full` app:

- **Dev clients copied into the app.** `app/hmr.js` and `app/refresh.js` speak the orchestrator's live-update protocol. Nobody customizes them, yet repair already tracks six old versions of `hmr.js`, and the ssg and full `refresh.js` have drifted apart. The portal's upgrade had to rewrite its copy.
- **The error reporter copied into the app.** `app/error.ts` reports browser errors to `/client-errors`, which is package code. It only runs when client navigation is on, because that is the only time the app bundle is loaded.
- **An app entry that is mostly Webstir's.** `app/app.ts` holds the hot-module registry, the error reporter's loader, and one import per enabled feature. A feature needs both a flag in `package.json` and that import, and the build fails if they disagree. `add-page` makes every page script import `../../app/app`.
- **Styles every page must import.** Each page's CSS starts with `@import "@app/app.css"`, and publish fails if `app.css` or one of its imports is missing. `styles/base.css` is imported by nothing.
- **A server entry that is boilerplate.** `src/backend/index.ts` is one call to start the server. Its presence is also what makes the app a server app.
- **Config and type stubs.** There are four tsconfigs (`base.tsconfig.json`, frontend, backend, shared) and two identical `.d.ts` files, one of which no tsconfig includes. `src/shared/` has an unused type. `package.json` pins `esbuild` and `autoprefixer`, which Webstir doesn't use.
- **Dead files.** `Errors.404.html`, `Errors.500.html` and `Errors.default.html` are read by nothing; the 404 page is `pages/404`. `webstir-backend/templates/**` and the providers' `getScaffoldAssets` are a second, unused copy of the starters.
- **Samples mixed with the starter.** The `lifecycle` page and the progressive-enhancement demo `module.ts`, which also carries frontend asset plumbing, are demos rather than a starting point.
- **Repair can't tell these apart.** Its "missing scaffold" list mixes dead files, samples and machinery, so it reports as missing files a working app doesn't need.

## What changes

1. **The dev clients are the package's.**
   - In `watch`, the dev server serves Webstir's live-update and reload clients at the same `/hmr.js` and `/refresh.js` addresses, so existing apps' `app.html` keeps working.
   - The build puts their tags into the page in development. `app.html` no longer needs them, and a tag already there isn't added twice.
   - One client serves every kind of app. The two `refresh.js` variants become one.
   - An app's own copy is no longer used.
2. **Error reporting is the package's.** The reporter is part of the app bundle every page loads. It's on by default in an app with a server (an app without one has nowhere to report to), and `webstir.enable.clientErrors` turns it off or on. It no longer depends on client navigation being on.
3. **The app entry is optional.**
   - The build makes the app bundle from the enabled features, Webstir's client runtime and the app's own `app.ts` if there is one. A flag alone enables a feature.
   - `webstir enable <feature>` sets the flag. It writes no import, and an app without `app.ts` can enable features.
   - The page's bundle is loaded whenever there is one, not only with client navigation.
   - `registerHotModule` becomes a package export (`@webstir-io/webstir-frontend/runtime`). New pages don't import `app/app`.
   - `app.ts` stays for an app's own global code: a theme, behaviors.
4. **Styles are linked, not imported.**
   - The build links `app.css` in every page's head when the app has one, before the page's own stylesheet, and publish does the same with the hashed file.
   - Pages drop `@import "@app/app.css"`, and `add-page` stops writing it. A missing `app.css` means no global styles, not a failed publish.
   - The starter's `app.css` holds its reset. `styles/` becomes the app's own folder, not the starter's.
   - Search's and content-nav's stylesheets are linked by the build when those features are on, so they no longer need an `@import` in `app.css`.
5. **The server entry is one call.**
   - `src/backend/index.ts` stays the file that says an app has a server: a static app keeps `module.ts` for build-time views, so `module.ts` can't say it. The starter's entry shrinks to the one call that starts the server.
   - An app that needs to run something before the server starts, like the Sqware portal's database adoption, keeps its own `index.ts`.
6. **Config and types come from the package.**
   - `@webstir-io/webstir-frontend/tsconfig.json` and `@webstir-io/webstir-backend/tsconfig.json` hold the compiler settings. The app's `src/frontend/tsconfig.json` and `src/backend/tsconfig.json` shrink to one `extends` line each, and the backend type-check uses the package's settings when the app has none.
   - The CSS-module and asset declarations come from the frontend package's types. `base.tsconfig.json`, `types/global.d.ts`, `types.global.d.ts` and `src/shared/` go from the starters.
   - `package.json` loses `esbuild`, `autoprefixer` and the empty `moduleManifest`.
7. **Dead files go.** The `Errors.*.html` pages, the unused backend package templates and the providers' unused scaffold assets are removed. There is one source of starter files, the orchestrator's templates.
8. **The starters are starting points.**
   - The full starter's `module.ts` becomes a small server example on the render layer: one view and one form. It drops the progressive-enhancement demo and its frontend asset plumbing.
   - The `lifecycle` page leaves the starter. The progressive-enhancement and lifecycle demos stay in `examples/demos/full`, which may add pages to the starter. The sync check compares the starter's files, not the whole demo.
   - A fresh full app becomes 14 files: `package.json`, `.gitignore`, `.env.example`, `AGENTS.md`, `app.html`, `app.css`, the home page (`index.html`, `index.css`, `index.ts` and its test), `index.ts` and `module.ts` for the server, and the two one-line tsconfigs. The ssg, spa and api starters shrink the same way.
9. **Repair moves existing apps across, only where it is safe.**
   - It deletes an app's copy of a machinery file (`hmr.js`, `refresh.js`, `error.ts`, the `Errors.*` pages) only when it matches a version Webstir shipped, as it already does for packaged features.
   - It removes the scaffold parts of `app.ts` (registry, error loader, feature imports) when they match what was shipped, and deletes the file if nothing else is left. It removes `@import "@app/app.css"` from pages.
   - It leaves an app's tsconfigs, `.d.ts` stubs and `index.ts` alone: they keep working, and the stubs are what the old tsconfigs type stylesheet imports with. The frontend README says how to move to the one-line tsconfigs by hand.
   - Anything customized is left alone, with a note saying what to change by hand.
   - "Missing scaffold" lists only real starter content.

## What stays

- The page model, the render layer, client navigation, islands, the batteries and every route and view API.
- `app.html` as the app's shell, with its `<main>` contract, and `app.css` as the app's styles.
- The `pages/404` page, `module.ts`, `sign-in.ts`, migrations and jobs.
- An app that keeps its own `app.ts`, `index.ts`, tsconfigs or type stubs keeps working as today.

## Tests and docs

- **Tests:**
  - A fresh app of each starter builds, watches (hot updates, reload, the status indicator), publishes and runs with no `hmr.js`, `refresh.js`, `error.ts`, `app.ts` or `base.tsconfig.json`.
  - A feature flag alone enables client-nav, search and content-nav; no import is needed.
  - Browser errors reach `/client-errors` with client navigation off; `clientErrors: false` stops them.
  - `app.css` is linked on every page in watch and publish, and no page stylesheet imports it.
  - An existing app with the old files keeps working before repair; repair removes the shipped copies, keeps customized ones with a note, and the app still builds and runs.
  - A page script doesn't install client navigation twice.
- **Docs:**
  - The templates reference, "what init writes", workspace layout, the CSS playbook, the lifecycle how-to (pointing at the demo) and the client error reporting section (its opt-out).
  - The repair notes and the frontend README's manual migration steps.
  - The CLI reference for `enable` and `add-page`.
- **Dogfood:**
  - The docs site (`apps/portal`) is repaired in the same change.
  - The Sqware portal follows after the release, in its own PR. It keeps its `app.ts` (behaviors) and `index.ts` (database adoption).

## Delivery

One PR on one branch, reviewed once, released once as **Webstir 0.8.0**: it changes what apps own, so it's a minor version. The work goes in the order of the items, each verified with its package's tests as it lands.

Then the Sqware portal runs `webstir repair` in its own PR. It deploys automatically; it changes development-only and build files, not data.

What can't be taken back: one package release. Repair rewrites and deletes app files, but only copies that match what Webstir shipped; everything else is left with a note.

## Decisions (defaults chosen; say if you want otherwise)

- **The dev clients keep their addresses** (`/hmr.js`, `/refresh.js`), so old shells keep working without a rewrite. The build adds the tags only when they're missing.
- **Error reporting is on by default,** in every app with pages, and turned off with a flag. That's today's intent, which today only works with client navigation on.
- **`app.css` is linked by the build rather than imported by pages.** An app whose pages rely on importing it keeps working, because the import still resolves. Repair removes it so each style is loaded once.
- **One change, one release.** Layers would each need their own review, release and portal follow-up for no gain to users.
- **The demos keep the samples.** The starter is where you start; the demos are where you learn.
