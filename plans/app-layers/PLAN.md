# Plan: modes become layers

Step 3 of making Webstir the framework you can pick for any web app. Steps 1 and 2 made every page one kind of page and gave every app one pipeline and one navigation. This step removes the last choice an app is locked into at `init`: its mode. An app is what its files say it is, and it can grow a backend, or pages, without starting over.

## What's there today

- **`webstir.mode` in `package.json`** (`spa`, `ssg`, `api` or `full`) is required, and is read in about 40 places. Almost every read is really one of three questions:
  - **Does the app have pages?** (build plan, watch, test targets, `inspect`, `doctor`, `agent`)
  - **Does it run a server?** (build plan, watch, test targets, backend inspect, published deploy)
  - **Does it publish as static files?** (`ssg` only: the static publish layout, views rendering at publish by default, build-time views in watch, the module prebuild)
- **`spa` has its own copy of one rule.** `full` and `ssg` fail a page with bindings that no view renders and that has no `data.ts` (`render/validate.ts`). `spa` checks the same thing separately (`render/spa.ts`), with its own messages and its own call sites in build, publish and rebuild.
- **Changing shape means changing mode:**
  - `webstir enable backend` rewrites `mode` to `full`, which silently turns off everything `ssg` did for a static site.
  - Nothing adds pages to an `api` app.
  - `webstir refresh <mode>` rescaffolds the whole app.
- **Mode flags that fight the mode:**
  - `publish --frontend-mode ssg|bundle` overrides the mode. A forced static publish skips both the SPA check and the module prebuild.
  - `webstir.enable.backend` is written by `enable backend`, but no build, watch, test or deploy code reads it.
- **Workspace mode isn't in the public contracts;** only the per-view `renderMode` is.

## What changes

1. **An app is its layers, read from its files.** One function reads them, in `module-contract` as a new node-only entry (`@webstir-io/module-contract/workspace`), and the orchestrator, frontend and backend all use it:
   - **Pages:** `src/frontend/` exists.
   - **Server:** a backend entry exists (`src/backend/index.*`). A server app deploys a Bun server: routes, request-time views, sessions, jobs.
   - **Static output:** there are pages and no server. The app publishes as files for any static host, and its views render at publish (a `src/backend/module.ts` without a server supplies their loaders, as `ssg` apps do today).

   `webstir.mode` is no longer read. An app with neither pages nor a server fails with that message.
2. **Everything follows the layers instead of the mode:**
   - **Build and publish:** frontend if pages; backend if server; static layout and publish-time views if no server.
   - **Watch:** frontend watch if pages; backend runtime and `/api` proxying if server; build-time views rendered in watch if no server.
   - **The rest:**
     - `test` targets, `inspect`, `doctor`, `agent` and `smoke`
     - published deploy (serves `dist/frontend` when it exists, rather than when `mode` is `full`)
     - `add-page`'s scaffold default
     - the command metadata that lists which modes a command supports
3. **SPA and SSG are the same kind of app:** pages without a server.
   - A frontend-only app publishes the static layout, which any static host serves.
   - Its pages render where their data comes from: at publish (a view), or in the browser (`data.ts`).
4. **One check for bindings in every app:** a page with bindings needs a data source (a view that names it, or a `data.ts`), or the build fails with the file and line. It runs the same way in watch, build and publish for every app with pages. The separate SPA check and its call sites go.
5. **Layers are added, not chosen once:**
   - `webstir enable backend` adds a server to any app. It no longer touches `mode`, so a static site keeps its pages and becomes a server app with them.
   - New `webstir enable frontend` adds pages to a server-only app: the app shell, a home page, the frontend dependency and the tsconfig reference.
   - Removing a layer is deleting its directory; build, watch and publish follow on the next run.
6. **`init` scaffolds a starter, not a mode:**
   - `webstir init [full|spa|ssg|api] <dir>` keeps its names. They pick a starting template (`full` stays the default).
   - After `init`, nothing records which starter was used.
   - `refresh <starter>` works the same way.
7. **Output and migration:**
   - `inspect`, `doctor`, `agent`, `smoke` and command output report `layers: { pages, server }` instead of `mode`.
   - `repair` removes `webstir.mode` and `webstir.enable.backend` from existing apps and says so.
   - `publish --frontend-mode` is removed; the layers decide.

## What stays

- The starters' templates, the demos' shapes and the portal's output.
- A server app's publish layout and deploy.
- The per-view `renderMode`, and `webstir.enable.*` for features (client-nav, search, content-nav, deploy targets).
- Everything from steps 1 and 2: the page model, one watch pipeline, client-nav.

## Tests and docs

- **Tests:**
  - A table test of layer detection:
    - pages only
    - server only
    - both
    - build-time loaders without a server
    - neither
    - a leftover `webstir.mode` that disagrees with the files
  - **The four starters still build, watch, test and publish as before,** apart from the SPA static layout.
  - **Growing an app end to end:**
    - `init ssg` then `enable backend` gives a working server app that keeps its pages.
    - `init api` then `enable frontend` serves pages beside the API.
    - `init spa` published is served by a plain static server, including a browser-rendered page.
  - **The bindings rule across apps:** a page with bindings and no data source fails in watch, build and publish of a server app and a static app, including one scaffolded from the `spa` starter. A view or a `data.ts` makes it pass.
  - **Repair** removes `mode` and `enable.backend`.
  - Existing mode tests (about 25 files) move to layers.
- **Docs:**
  - Rewrite **Workspace** (explanation), **Init** and **Workflows** around layers and starters.
  - Update:
    - **Enable** (`enable frontend`, `enable backend` no longer switches mode)
    - **Publish**, **Static Sites**, **CLI** and **Watch**
    - **Docker**, the engine and services explanations, the templates reference, and the backend-loop tutorial
    - the app `AGENTS.md` template, which today says `webstir.mode` identifies the app

## Delivery

One PR, with a changeset. Merging it releases **Webstir 0.5.0** (minor: `mode` is retired, SPA publish output changes, and `--frontend-mode` goes away). That publish is the one irreversible step.

## Decisions (defaults chosen; say if you want otherwise)

- **Layers are read from files,** not declared in `package.json`. The files already have to exist for a layer to work, so a second declaration can only disagree with them.
- **SPA and SSG merge into "pages without a server",** publishing the static layout. A separate SPA publish layout needs a server to map its paths, which an app without a server doesn't have.
- **Starter names stay** (`full`, `spa`, `ssg`, `api`), so existing commands and docs keep working. They only choose a template now.
- **`--frontend-mode` is removed** rather than kept as an override. It only exists because the mode could be wrong about the app, which layers can't be.

## As built

- **Output and JSON report layers** instead of `mode`. Commands say which layer they need.
- **One `hmr.js`** for every starter. `repair` upgrades the 0.4 SPA/full client.
- **`repair` restores from the starter that fits the layers:** pages + server → full, server → api, pages → ssg with `content/`, else spa. That includes the backend, so it no longer restores the fuller scaffold `enable backend` writes.
- **Rejected watch rebuilds restore the whole output,** which replaces the separate SPA check.
- **`add-page`** makes a page with `index.ts` in every app; `--no-script` makes one without.
- **Old deploy scripts keep working:** the frontend package CLI still accepts, and ignores, `publish -m`.
- **Published deploy reads layers from its published output** (`build/backend/index.js`, `dist/frontend`), since a deploy image carries no `src/`.
- **`enable backend` and `enable frontend` say to run `bun install`** when they add a dependency. `enable frontend` notes that once an app has pages, its server answers under `/api/*`.
