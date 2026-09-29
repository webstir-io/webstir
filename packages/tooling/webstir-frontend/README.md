# @webstir-io/webstir-frontend

HTML-first frontend delivery for Webstir workspaces. This package builds page documents, shared app assets, CSS, and browser-side enhancement scripts for applications that start with server-rendered HTML and selectively add JavaScript where it improves the experience.

## What It Ships

- Multi-page HTML/CSS/JS builds for `src/frontend/**`
- Publish output with fingerprinted assets under `dist/frontend/**`
- Watch-mode rebuilds used by the Bun orchestrator
- Shared app-shell assets such as navigation, refresh, and client enhancement hooks
- Runtime helpers for boundary-style mount/unmount lifecycles and cleanup scopes
- Static-site publish for apps without a server, without making static-only delivery the center of the product story

Requires Bun **1.3.11** or newer.

## Runtime Model

Client code that participates in hot updates should use the boundary runtime instead of relying on module top-level side effects.

```ts
import { createCleanupScope, defineBoundary } from '@webstir-io/webstir-frontend/runtime';
```

- `createCleanupScope()` collects cleanup handlers and disposes them in reverse registration order.
- `defineBoundary()` wraps a page or app region with explicit `mount()` and `unmount()` lifecycle methods.
- Boundary scopes can mount nested child boundaries with `scope.mountChild(...)`; child boundaries unmount before the parent boundary tears down.
- Boundaries can opt into hot-state preservation with `snapshotState()` and `restoreState()`; when those hooks are absent, remounts start fresh.
- `listen()`, `scheduleTimeout()`, `scheduleInterval()`, `trackObserver()`, and `createAbortController()` wrap common side effects so cleanup stays attached to the boundary scope.
- Boundary code should register DOM listeners, timers, observers, and similar side effects through the cleanup scope so remounts stay deterministic.

## Islands

A page can place components from React, Preact, Solid, Svelte or Vue, or plain `mount` code, with `data-island="<name>"`; they live in `src/frontend/islands/`. The build bundles them with shared chunks under `/app/islands/`, adds the islands loader only to pages that use them, and checks names, `data-load` strategies and `data-props` paths. See the [Islands guide](https://webstir.dev/docs/how-to/islands/).

## Hot Update Rules

Webstir watch mode follows a narrow fallback policy:

- CSS edits hot-swap in the browser.
- Edits to an island (`src/frontend/islands/*`) mount that island again from the new code, where it is.
- Edits to a page's code (anything under `src/frontend/pages/<page>/` that compiles to JavaScript) show the current page again from the new code, in place, when client-nav is on: the old page's cleanup runs, then the new `load` and `setup`, while scroll, focus and the app shell stay. Without client-nav, the page reloads.
- Most content, HTML, and route-shape changes fall back to rebuild + reload.
- Current exception: in apps without a server, edits to the docs page (`src/frontend/pages/docs/`) or a `src/frontend/content/**/_sidebar.json` re-import the docs page's module, whose sidebar remounts itself, instead of refreshing the page. A module that registered handlers with `registerHotModule` has them run.
- Any cleanup failure or declined boundary update falls back to reload.
- A page opts a module in with `registerHotModule(import.meta.url, { accept, dispose })` from `@webstir-io/webstir-frontend/runtime`. That call only queues the handlers in `window.__webstirHotModules`; Webstir's dev-only client (served at `/hmr.js` in `watch`) drains the queue into its own registry, so production bundles carry no hot-update code.

### Moving an older workspace onto the package

Older workspaces carry Webstir's plumbing in the app: a hot-module registry and an error loader in `app.ts`, the error reporter in `error.ts`, the dev clients `hmr.js` and `refresh.js`, feature imports in `app.ts` and `app.css`, and `@import "@app/app.css"` in each page stylesheet. The package does all of that now, and an app that still has them keeps working until it moves.

1. Run `webstir repair`. It removes each of those where it is still what a Webstir version wrote, and deletes `app.ts` when nothing of the app's own is left.
2. Where the app changed one, repair leaves it and prints a note. By hand:
   - In `app.ts`, delete the hot-module types, the `declare global` block and `registerHotModule`, and the error loader (`errorHandlerLoaded`, `loadErrorHandler`, its two `window.addEventListener` calls and its export). Delete `app.ts` if nothing else is left.
   - Import `registerHotModule` from `@webstir-io/webstir-frontend/runtime` in any page that imported it from `app.ts`.
   - Delete `error.ts` once nothing you changed in it is needed; `webstir.enable.clientErrors` turns the packaged reporter off.
   - Remove `@import "@app/app.css"` from page stylesheets, moving any layer or media condition on it into `app.css`.
3. Optionally, move to the package's compiler settings, which repair leaves to you: make `src/frontend/tsconfig.json` `{ "extends": "@webstir-io/webstir-frontend/tsconfig.json" }` and `src/backend/tsconfig.json` `{ "extends": "@webstir-io/webstir-backend/tsconfig.json" }`, keeping any options of your own beside the `extends`. Then `base.tsconfig.json`, `types.global.d.ts`, `types/global.d.ts` and an unused `src/shared/` can go.

## Fragment Ownership Decision

The current SSG runtime has a working fragment-ownership pilot on the docs sidebar boundary. It now covers the sidebar manifest input (`src/frontend/content/_sidebar.json`) in addition to direct docs page module edits, but owned-fragment HTML replacement is still not justified yet as a general mechanism.

Keep reload/remount as the default until the runtime has:

- More than one real owned fragment with clear parent/child invalidation rules
- A stable fragment-to-source mapping for generated HTML updates
- A lifecycle contract for replacing HTML without duplicating side effects or breaking page state

Until then, content and HTML changes should continue to fall back to rebuild + reload.

## HTML-First Workflow

The frontend package is designed to pair with the backend runtime rather than replace it:

- Build document shells under `build/frontend/pages/**`
- Publish optimized assets under `dist/frontend/**`
- Let backend routes or request-time views deliver HTML first
- Use enhancement scripts for fragment updates, navigation polish, and form handling when JavaScript is available

Canonical proof apps in this repo:

- [`examples/demos/auth-crud`](../../../examples/demos/auth-crud) for server-handled auth, validation, redirect-after-post, and CRUD flows
- [`examples/demos/dashboard`](../../../examples/demos/dashboard) for shell-level and panel-level partial refreshes without SPA architecture

## Quick Start

1. Install the package

```bash
bun add @webstir-io/webstir-frontend
```

2. Build a workspace

```bash
bunx webstir-frontend build --workspace /absolute/path/to/workspace
```

3. Publish optimized frontend assets

```bash
bunx webstir-frontend publish --workspace /absolute/path/to/workspace
```

## Workspace Layout

```text
workspace/
  src/frontend/
    app/
    pages/
    images/
    fonts/
    media/
    frontend.config.json   # optional feature flags
    webstir.config.mjs     # optional hooks
  build/frontend/...       # watch/build output
  dist/frontend/...        # publish output
  .webstir/manifest.json   # pipeline manifest
```

## CLI Commands

Binary name: `webstir-frontend`. All commands require `--workspace`.

| Command | Description | Useful options |
| --- | --- | --- |
| `build` | Runs the development-oriented pipeline. | `--changed-file <path>` to scope rebuilds. |
| `publish` | Produces optimized frontend assets; the app's layers decide the output shape. | None (`--mode` is accepted and ignored) |
| `rebuild` | Incremental rebuild after a file change. | `--changed-file <path>` |
| `add-page <name>` | Scaffolds `index.html`, `index.css`, and `index.ts`. | `--mode ssg` to leave out `index.ts`; in an app with a server it also adds an `ssg` view for the page to `package.json` |

## Feature Flags

`frontend.config.json` controls optional pipeline features:

```jsonc
{
  "features": {
    "htmlSecurity": true,
    "externalResourceIntegrity": false,
    "imageOptimization": true,
    "precompression": false
  },
  "shell": {
    "stickyHeader": false
  }
}
```

`externalResourceIntegrity` stays `false` by default so publish does not fetch third-party script or stylesheet URLs just to compute SRI. Enable it only when you explicitly want remote fetches during publish; otherwise, add `integrity` and `crossorigin` attributes yourself for external CDN assets.

Publish always injects the small app-shell reset and typography critical CSS. Sticky-header variables, fixed `.app-header` geometry, and the matching body offset are added only when the composed document contains `.app-header`. Set `shell.stickyHeader` to `true` only for a custom header shell that needs the same reserved top space without using the standard class.

Standard pages keep TypeScript in `src/frontend/pages/<page>/index.ts`, while their HTML references `index.js`; publish rewrites that browser-safe reference to the fingerprinted bundle. Publishing fails if emitted HTML still references `.ts`, `.tsx`, or `.jsx`, or if an emitted document points at a local asset that is absent from `dist/frontend`.

## Content Pages

Markdown under `src/frontend/content/` is published beneath `content.basePath` (default `/docs/`) and labeled with `content.label` in breadcrumbs and navigation:

```jsonc
{
  "content": {
    "basePath": "/company/",
    "label": "Company",
    "titleTemplate": "{title} | Example Co"
  }
}
```

`titleTemplate` is optional. When set, each content page's `<title>` and `og:title` become the template with `{title}` replaced by the page title; the template must include `{title}`. Without it, content pages combine the page title with the app shell's `<title>`, if one exists.

## Lifecycle Hooks

Hooks live in `webstir.config.mjs` (or `.js` / `.cjs`) at the workspace root:

```js
export const hooks = {
  pipeline: {
    beforeAll({ mode }) {
      console.info(`[webstir] starting ${mode} pipeline`);
    }
  },
  builders: {
    assets: {
      after() {
        // custom post-processing
      }
    }
  }
};
```

## API Usage

```ts
import { frontendProvider } from '@webstir-io/webstir-frontend';

const result = await frontendProvider.build({
  workspaceRoot: '/absolute/path/to/workspace',
  env: { WEBSTIR_MODULE_MODE: 'publish' }
});

console.log(result.manifest.entryPoints);
```

- `frontendProvider.metadata` exposes package and runtime-compatibility metadata
- `frontendProvider.resolveWorkspace()` returns canonical source/build roots
- `frontendProvider.build()` executes the pipeline and returns artifacts plus manifest data
- `inspectFrontendWorkspace()` returns resolved config plus shallow workspace facts without building

## Static Sites

An app with pages (`src/frontend/`) and no server (`src/backend/index.{ts,tsx,js,mjs}`) publishes as a static site, not a separate product:

```bash
bunx webstir-frontend publish --workspace /absolute/path/to/workspace
```

That run:

- Builds normal publish assets under `dist/frontend/**` in the static layout: `dist/frontend/<page>/index.html` and `dist/frontend/index.html` for the `home` page
- Renders views at publish, with loaders from `src/backend/module.ts`
- Uses `webstir.moduleManifest.views` metadata when present to emit extra static paths

An app with a server publishes its pages under `dist/frontend/pages/<page>/` for the server to serve.

## Maintainer Workflow

```bash
bun install
bun run clean
bun run build
bun run test
# From the repository root, describe the change for the next release
bun run changeset
```

Recommended package validation before release:

- `bun run build`
- `bun run test`

## Troubleshooting

- `No frontend test files found`
  The package test script expects compiled tests under `tests/**/*.test.js`.
- `Missing entry points in manifest`
  Confirm `build/frontend` contains at least one generated JS entry.
- `SSG output missing a route`
  Check `webstir.moduleManifest.views` for `renderMode: "ssg"` and the expected `staticPaths`.

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md

## Third-Party Notices

Webstir Frontend depends on third-party libraries and data sets (including `sharp` / libvips and `caniuse-lite`) under their respective licenses. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the attribution summary.

## License

MIT © Webstir

## Client navigation page lifecycle

With `webstir.enable.clientNav` enabled, a page entry can export
`setup(context: PageContext)`. The navigator calls it once on the initial document
and once per committed document visit, including history traversal and different
URLs served by the same cached module. See the [lifecycle guide](../../../apps/portal/src/frontend/content/how-to/client-nav-lifecycle.md)
and the full demo's `/lifecycle` page.

`PageContext` supplies the current `root` (`<main>`), a `URL`, an `AbortSignal`,
and the existing `CleanupScope`. Register resources with `listen`,
`scheduleTimeout`, `scheduleInterval`, `trackObserver`, or `scope.add`.
Setup may return a cleanup function, synchronously or asynchronously. Register
cleanup before awaiting; check `signal.aborted` before effects after an await.

This contract does not opt a module into HMR. Keep the default reload behavior
for these pages; do not independently mount the same page through a hot boundary
or a client-nav event listener.
