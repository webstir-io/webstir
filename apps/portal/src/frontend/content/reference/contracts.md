# Contracts & Invariants

Current user-visible behaviors that Webstir documents and tests while the framework is still experimental. Treat this page as the present shape of the Bun-based workflow, not a long-term stability guarantee across releases.

## Source Layout
- Frontend: `src/frontend/**`
- Pages: `src/frontend/pages/<page>/index.html|css|ts`
- App assets: `src/frontend/app/**`
- Static assets: `src/frontend/{images|fonts|media}/**`
- Backend: `src/backend/**` (entry: `src/backend/index.ts`)
- Shared: `src/shared/**`
- Types: `types/**`

## Dev Outputs
- `build/frontend/**` (includes `pages`, `images`, `fonts`, `media`)
- `build/backend/**`

## Publish Outputs
- Per page under `dist/frontend/pages/<page>/`:
  - `index.html`
  - `index.<timestamp>.css`
  - `index.<timestamp>.js`
  - `manifest.json` (lists fingerprinted asset names)
- Static assets under `dist/frontend/{images|fonts|media}/**`
- App assets under `dist/frontend/app/**`

## HTML Composition
- Base HTML at `src/frontend/app/app.html` must contain a `<main>` where page HTML is merged.
- Clean URLs in dev: `/about` serves `/pages/about/index.html`.

## JavaScript/TypeScript
- ESM-only module graph; CommonJS is not supported.
- Compiled via `tsc --build` using the embedded base `tsconfig`.

## CSS
- Resolves `@import` and asset URLs in dev.
- Publish minification/prefixing (modern-only): preserves strings/urls and license comments; trims whitespace and trailing `;`; normalizes numbers/zeros; collapses zero shorthands; shortens hex (`#rrggbb→#rgb`, `#rrggbbaa→#rgba`); strips legacy prefixes/values (`-ms-*`, `-o-*`, `-khtml-*`, legacy flexbox); adds minimal `-webkit-` where needed.

## Dev Server
- Serves `build/frontend/**` with SSE reload and an `/api/*` proxy to the Bun backend runtime.
- No-cache headers for HTML; short/no-cache for static assets in dev.
- Accepts client error reports at `POST /client-errors` (the Bun backend runtime serves the same route in published full and API workspaces):
  - Requires `Content-Type: application/json` and body up to 32KB.
  - Returns `204` on success; `415` for unsupported media type; `413` if payload too large.
  - Forwards to the error tracking hook with correlation id support (`X-Correlation-ID` or payload `correlationId`).

## HTML
- `<script data-webstir-inline src="…">` tags are bundled from their source at build time and inlined into the page; publish bundles them again, minified. Relative sources resolve against the containing file, leading-slash sources against `src/frontend`.

## Error Handling
- Missing required inputs (base HTML, server entry) fails fast with clear messages.
- Publish removes comments and source maps from outputs.
- The SPA and full templates include a client error reporter (loaded from `src/frontend/app/error.ts` on the first error) that throttles to 1/sec (max 20/session) and deduplicates repeats for 60s. The SSG template omits it.

## CLI Guarantees
- Commands: `init`, `refresh`, `inspect`, `frontend-inspect`, `doctor`, `repair`, `enable`, `build`, `watch`, `test`, `publish`, `smoke`, `backend-inspect`, `add-page`, `add-test`, `add-route`, `add-job`, `mcp`.
- Running `webstir` with no command prints help; there is no default implicit workflow.
