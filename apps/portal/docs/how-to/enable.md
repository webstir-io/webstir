# Enable Features

Webstir supports an `enable` workflow to opt into optional functionality by writing the required scaffold files and turning on the corresponding `package.json` flags.

## Usage

```
webstir enable <feature>
webstir enable scripts <page>
```

Supported features:
- `scripts <page>` — add `index.ts` to an existing page
- `spa` — opt into SPA routing
- `client-nav` — enable client-side navigation (feature module)
- `search` — enable site search UI + behavior (feature modules + CSS)
- `content-nav` — enable docs content navigation (sidebar, breadcrumb, h2 TOC)
 - `content-nav` — enable docs content navigation (sidebar + breadcrumb)
- `backend` — add backend scaffold and switch to `webstir.mode=full`

## What `enable` Changes

### scripts `<page>`
- Adds `src/frontend/pages/<page>/index.ts`.
- Fails if the page does not exist or already has `index.ts`.

### spa
- Writes SPA/router scaffold under `src/frontend/app/**`.
- Updates `package.json`:
  - `webstir.enable.spa=true`

### client-nav
- Writes `src/frontend/app/scripts/features/client-nav.ts`.
- Appends a side-effect import to `src/frontend/app/app.ts`:
  - `import "./scripts/features/client-nav.js";`
- Updates `package.json`:
  - `webstir.enable.clientNav=true`

### search
- Writes:
  - `src/frontend/app/scripts/features/search.ts`
  - `src/frontend/app/styles/features/search.css`
- Appends imports:
  - `src/frontend/app/app.ts`: `import "./scripts/features/search.js";`
  - `src/frontend/app/app.css`: adds the `features` layer (if missing) and imports `./styles/features/search.css`
- Enables CSS-style search mode by adding an attribute to `src/frontend/app/app.html`:
  - `<html data-webstir-search-styles="css">`
- Updates `package.json`:
  - `webstir.enable.search=true`

### content-nav
- Writes:
  - `src/frontend/app/scripts/features/content-nav.ts`
  - `src/frontend/app/styles/features/content-nav.css`
- Appends imports:
  - `src/frontend/app/app.ts`: `import "./scripts/features/content-nav.js";`
  - `src/frontend/app/app.css`: `@import "./styles/features/content-nav.css";`
- Updates `package.json`:
  - `webstir.enable.contentNav=true`
Applies to SSG docs pages (content pipeline) only.

### backend
- Creates `src/backend/**` if missing (using the embedded full-stack backend scaffold).
- Updates `package.json`:
  - `webstir.mode=full`
  - `webstir.enable.backend=true`
- Ensures `base.tsconfig.json` includes a `references` entry for `src/backend`.

## Notes
- `enable` is additive and idempotent: it avoids duplicating imports on re-run.
- Feature scripts are appended as `.js` imports in `app.ts` because the dev server serves the compiled output under `build/frontend/**`.
