# Enable Features

Webstir supports an `enable` workflow to opt into optional enhancements after the baseline server-first app is already working. It writes the required scaffold files and turns on the corresponding `package.json` flags.

## Usage

```
webstir enable <feature>
webstir enable scripts <page>
```

Supported features:
- `scripts <page>` — add `index.ts` to an existing page
- `client-nav` — enable client-side navigation (feature module)
- `search` — enable site search UI + behavior (feature modules + CSS)
- `content-nav` — enable docs content navigation (sidebar, breadcrumb, h2 TOC)
- `backend` — add a server (the backend scaffold) to an app that has none
- `frontend` — add pages (an app shell and a home page) to an app that has none
- `github-pages [basePath]` — scaffold a Bun-based GitHub Pages deploy script and set the publish base path
- `gh-deploy [basePath]` — `github-pages` plus a GitHub Actions workflow
- `s3-cloudfront` — scaffold an S3 + CloudFront deploy script, the edge function that maps directory URLs to `index.html`, and a GitHub Actions workflow

`webstir enable spa` is gone: the SPA router it installed was never called, and client-nav is how Webstir apps navigate. `webstir repair` lists router files an older app still has, and leaves deleting them to you.

## What `enable` Changes

### scripts `<page>`
- Adds `src/frontend/pages/<page>/index.ts`.
- Fails if the page does not exist or already has `index.ts`.

### client-nav
- New `spa` and `full` apps start with client-nav on.
- Imports client-nav from the frontend package in `src/frontend/app/app.ts`; no files are copied:
  - `import '@webstir-io/webstir-frontend/features/client-nav';`
- Updates `package.json`:
  - `webstir.enable.clientNav=true`
- An app that still has the client-nav copies older Webstir versions wrote (`src/frontend/app/scripts/features/{client-nav,document-navigation,form-enhancement}.ts`) has them removed and its import switched, unless a copy was edited; then the copies stay and the command says how to move over.

### search
- Imports the feature from the frontend package; no files are copied:
  - `src/frontend/app/app.ts`: `import '@webstir-io/webstir-frontend/features/search';`
  - `src/frontend/app/app.css`: adds the `features` layer (if missing) and `@import "@webstir-io/webstir-frontend/features/search.css";`
- Updates `package.json`:
  - `webstir.enable.search=true`

### content-nav
- Imports the feature from the frontend package; no files are copied:
  - `src/frontend/app/app.ts`: `import '@webstir-io/webstir-frontend/features/content-nav';`
  - `src/frontend/app/app.css`: adds the `features` layer (if missing) and `@import "@webstir-io/webstir-frontend/features/content-nav.css";`
- Updates `package.json`:
  - `webstir.enable.contentNav=true`
- Applies to SSG docs pages (content pipeline) only.

An app that still has the copies an older version wrote under `src/frontend/app/scripts/features/` and `src/frontend/app/styles/features/` is switched over: its imports are rewritten and the copies removed, unless a copy was edited or another file still imports one; then everything stays and the command says how to move over.

### backend
- In an app without a server, writes the same server `init` gives: the entry `src/backend/index.ts` and `src/backend/tsconfig.json`. Files the app already has stay as they are, such as the `module.ts` a static app keeps for build-time views.
- Adds the backend package dependency; run `bun install` afterwards.
- Removes a leftover `webstir.mode` or `webstir.enable.backend` from `package.json`.
- Ensures `base.tsconfig.json` includes a `references` entry for `src/backend`.

### frontend
- In an app without pages, writes an app shell and a home page under `src/frontend/**` (from the `spa` starter), with client-nav on.
- Adds the frontend package dependency (run `bun install` afterwards) and a `base.tsconfig.json` reference for `src/frontend`.
- Once an app has pages, its pages own the site's addresses and its server answers under `/api/*`. Routes outside `/api/` are no longer reachable from the browser, so the command says to move them under `/api/`.

### github-pages
- Writes `utils/deploy-gh-pages.sh`.
- Updates `src/frontend/frontend.config.json`:
  - `publish.basePath="/<workspace-name>"` by default, or the path you pass
- Updates `package.json`:
  - `webstir.enable.githubPages=true`
  - adds `scripts.deploy="bash ./utils/deploy-gh-pages.sh"` if missing

### gh-deploy
- Applies all `github-pages` changes.
- Also writes `.github/workflows/webstir-gh-pages.yml` if it does not already exist.
- The generated workflow is Bun-based and runs `bun install` plus `bun run deploy`.

### s3-cloudfront
- Writes `utils/deploy-s3-cloudfront.sh`: builds and publishes the site, uploads new fingerprinted bundles first, then documents, records the bundles this publish references in `.webstir-deploys/<timestamp>.txt`, then invalidates `$CLOUDFRONT_DISTRIBUTION_ID` when set. Previous bundles are never deleted during the deploy, because edge caches and already-open pages can still reference them. Cleanup runs last. A release counts as active from its publish until the next publish, and a bundle is removed only when no release active at any point in the past `S3_BUNDLE_RETENTION_DAYS` days (default 7) referenced it, so a release that sat untouched for months is still protected on the deploy that replaces it. A bucket with no manifest history is left untouched. The manifests are plain lists of bundle paths stored in the bucket under `.webstir-deploys/`, so they are fetchable through the CDN but reveal nothing the page HTML does not already reference.
- Writes `utils/cloudfront-rewrite-directory-index.js`, a CloudFront Function for the viewer-request event. Attach it to the distribution once; without it the S3 REST origin returns 404 for every page except `/`, because it does not map `/about/` to `about/index.html`.
- Writes `.github/workflows/webstir-s3-cloudfront.yml` if it does not already exist. The workflow assumes an OIDC role from `vars.AWS_ROLE_ARN`, reads `vars.AWS_REGION`, `vars.S3_BUCKET`, and `vars.CLOUDFRONT_DISTRIBUTION_ID`, and runs the S3 script directly so it is unaffected by whatever `scripts.deploy` points at.
- Updates `package.json`:
  - `webstir.enable.s3CloudFront=true`
  - adds `scripts.deploy="bash ./utils/deploy-s3-cloudfront.sh"` if missing
- Does not touch `publish.basePath`; the site is served from the bucket root.

## Notes
- `enable` is additive and idempotent: it avoids duplicating imports on re-run.
- Feature scripts are appended as `.js` imports in `app.ts` because the dev server serves the compiled output under `build/frontend/**`.
- Prefer the server-first path for forms, links, redirects, and auth before enabling client-nav or other UI polish.

For interactive page setup, cleanup, and migration from top-level scripts, see
[Client navigation page lifecycle](./client-nav-lifecycle.md).
