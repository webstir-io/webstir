# Templates

Embedded scaffolding used by the CLI to create projects and generate files. Keeps new apps consistent and zero-config.

## Overview
- Repo source of truth lives under `orchestrators/bun/resources/templates/**`.
- Generated package assets live under `orchestrators/bun/assets/templates/**` and are embedded into the Bun CLI package.
- `webstir init` lays down a server-first project from the `full` starter by default.
- Generators add files in the right place with sensible defaults.

## Layout
Created by `webstir init` according to the starter:

- `full`: frontend, backend, shared, and types, with client-nav on
- `spa`: frontend, shared, and types, with client-nav on
- `ssg`: frontend and types
- `api`: backend, shared, and types

The starter only chooses the starting files. After init, the app's layers come from those files: pages when `src/frontend/` exists, a server when `src/backend/index.ts` exists.

Typical frontend scaffold:

- `src/frontend/app/app.html`
- `src/frontend/app/**`
- `src/frontend/pages/<page>/index.html|css` plus `index.ts` for standard pages
- `src/frontend/{content,images,fonts,media}/**`

Typical backend scaffold:

- `src/backend/index.ts`
- `src/backend/module.ts`
- `src/backend/jobs/**`
- `src/backend/tests/**`

## Conventions
- Base HTML requires a `<main>` in `src/frontend/app/app.html` for page merge.
- Page folder names must be one non-empty path segment without separators, `.` / `..`, NUL bytes, or platform-reserved names and characters.
- Each page has `index.html` and `index.css`; standard pages also have `index.ts`, while `add-page --no-script` omits it.
- Backend entry is `src/backend/index.ts`.
- Fresh `api` and `full` starters keep `src/backend/index.ts` thin and use it to boot the package-managed Bun runtime.
- Manifest-backed route and demo logic lives in `src/backend/module.ts`.
- The default app primitives are documented in [Primitives](./primitives.md); treat that page as the naming contract for pages, forms, actions, fragment targets, request-time views, and auth-gated routes.
- For optional app features, prefer absolute app-asset imports such as `await import('/app/search.js')` so dev and publish paths stay aligned.
- Start with `full` when the app needs forms, redirects, auth, or server-rendered documents; start with `spa` or `ssg` for pages without a server, which publish as a static site.

## TypeScript
- Uses an embedded `base.tsconfig.json` referenced by template tsconfigs.
- ESM-only; compiled via the active provider packages.
- Shared code in `src/shared` is compiled for both frontend and backend.
- Dev output keeps source maps for local debugging; publish strips them.
- Dynamic imports load at runtime. Keep `/app/...` imports absolute for assets under `src/frontend/app/`.

## CSS & Assets
- Plain CSS by default; optional CSS Modules in publish.
- `@import` and asset URLs are resolved; files copied to outputs.
- Place static app assets under `src/frontend/app/*`.
- Place Images, Fonts, and Media under `src/frontend/{images|fonts|media}/**`.

## Inline Scripts
- A script tag marked `data-webstir-inline` names a TypeScript or JavaScript source that the build bundles and writes into the tag itself, so it runs before anything paints. Use it for the small things that must be right on the first frame, such as a theme or a computed backdrop:
  - `<script data-webstir-inline src="./scripts/first-paint.ts"></script>` in `src/frontend/app/app.html` runs on every page; the same tag in a page's `index.html` runs on that page.
  - A relative `src` resolves against the file that contains the tag; a leading `/` resolves against `src/frontend`, the way `/app/app.js` does.
- The bundle is an immediately-invoked script with its imports included, readable in development and minified on publish. `webstir watch` rebuilds the page HTML when the source or anything it imports under `src/frontend/app` or the page changes.
- The build keeps the source path in the attribute (`data-webstir-inline="src/frontend/app/scripts/first-paint.ts"`) and drops `src`; client-side navigation leaves inline head scripts in place, so they run on full loads only.
- A missing source fails the build. A published (minified) bundle over 16 KB gets a `frontend.inlineScript.large` warning, because it travels with every page that includes it; the readable build output is not measured.

## Client Error Reporting
- The SPA and full templates install a lightweight client error reporter: `src/frontend/app/app.ts` listens for `window` `error` and `unhandledrejection`, loads `src/frontend/app/error.ts` on the first one, and reports to `POST /client-errors` using `sendBeacon` (fallback to `fetch`).
- The SSG template does not include it: a static site has no server to report to.
- Behavior:
  - Throttled: max 1 event/second; capped at 20 per page session.
  - Deduped: repeats suppressed within 60s using a fingerprint of type|message|file:line:col|stack-hash.
  - Correlation: includes a client correlation id; the server also accepts `X-Correlation-ID`.
- Where reports go: `webstir watch` prints each report in the terminal next to the build output; the Bun backend runtime logs it at error level, so apps with a server have a sink in production.
- Opt-out: delete `src/frontend/app/error.ts` and remove the `loadErrorHandler` section from `src/frontend/app/app.ts`.

## Generators

### add-page
- Command: `webstir add-page <name> --workspace <path> [--no-script]`
- Calls the canonical `@webstir-io/webstir-frontend` helper to scaffold `index.html|css` plus `index.ts`; `--no-script` leaves out `index.ts`.
- Does not modify existing pages or `app.html`.
- Name validation: rejects control characters, trims surrounding spacing, preserves case and internal spaces, and requires one portable non-empty path segment (not `.` or `..`, a platform-reserved name, or a name containing reserved characters).

### add-test
- Command: `webstir add-test <name-or-path> --workspace <path>`
- Uses the canonical `@webstir-io/webstir-testing` helper to create `<name>.test.ts` under the nearest `tests/` directory; older published installs fall back to `webstir-testing-add`.
- Validates every path segment for portable filenames before creating directories or files.
- Works for both frontend and backend tests.

## Backend Template
- `src/backend/index.ts` starts the server with the package's defaults: `createDefaultBunBackendBootstrap({ importMetaUrl: import.meta.url })`. Pass options there to change them, such as a session store or `resolveRequestAuth`.
- `src/backend/module.ts` holds the app's routes and views (the full starter's demo module; the api starter adds one when it needs it).
- `.env.example` lists the server's settings; `.gitignore` keeps `data/`, `.webstir/` and `.env` out of git. See [Environment](./env.md).
- Health endpoints: `GET /api/health` and `/healthz`; a readiness probe at `/readyz` that returns the manifest summary; request counts and timings at `/metrics`.
- The batteries come with the package, not the template:
  - a database with migrations from `src/backend/migrations` ([Use the Database](../how-to/database.md))
  - sessions kept in it ([Keep Sessions](../how-to/sessions.md))
  - jobs on a schedule or queued ([Run Jobs](../how-to/add-job.md))
  - email ([Send Email](../how-to/email.md)) and file storage ([Store Files](../how-to/files.md))
  - email-code sign-in, with `webstir enable sign-in` ([Add Sign-In](../how-to/sign-in.md))
- Bearer-token auth for an API with its own identity provider: `resolveRequestAuth: (request) => resolveBearerAuth(request)`, from `@webstir-io/webstir-backend/auth/bearer`, reading the `AUTH_*` settings. Unsupported algorithms, malformed tokens, bad signatures, wrong issuer or audience, and invalid time claims fail closed.

## Publish Outputs
- Per page: `dist/frontend/pages/<page>/index.html` in an app with a server; `dist/frontend/<page>/index.html` (and `dist/frontend/index.html` for `home`) in an app without one
- Fingerprinted assets: `dist/frontend/pages/<page>/index.<timestamp>.{css|js}`
- Per-page `manifest.json` listing hashed asset names.
- App assets copied to `dist/frontend/app/*`.

## Customizing Templates
- Edit templates under `orchestrators/bun/resources/templates/`.
- Regenerate the shipped package assets with `bun run --filter @webstir-io/webstir build` or `cd orchestrators/bun && bun scripts/sync-assets.mjs`.
- Use `bun run --filter @webstir-io/webstir check:assets` to verify the generated tree is still in sync.
- Keep conventions intact (page structure, base HTML `<main>`, server entry path).
- After changes, rebuild the CLI to embed updated templates.

## Related Docs
- Solution overview — [solution](../explanations/solution.md)
- Primitives — [primitives](./primitives.md)
- CLI reference — [cli](cli.md)
- Engine internals — [engine](../explanations/engine.md)
- Pipelines — [pipelines](../explanations/pipelines.md)
- Workspace and paths — [workspace](../explanations/workspace.md)

The full template includes `/lifecycle`, demonstrating the optional page `setup`
export and cleanup scopes. Client-nav itself ships in `@webstir-io/webstir-frontend`
(`packages/tooling/webstir-frontend/src/features/`); apps import it, so there are no
copies to refresh.
