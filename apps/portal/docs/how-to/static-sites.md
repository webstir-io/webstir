# Static Sites (SSG Preview)

Build and deploy a static version of your frontend using the Webstir frontend provider. This preview relies on `webstir-frontend` directly and is intended for marketing/landing sites and simple apps.

See also: [CSS Playbook](./css-playbook.md) for the minimal, convention-first styling approach used by the SSG starter.

## When To Use
- You want a fast, cacheable site (e.g., company landing page) with no server-side rendering or dynamic HTML.
- You are comfortable using the `webstir-frontend` CLI alongside `webstir` while SSG support is integrated into the main orchestrator.

## Requirements
- A standard Webstir workspace layout with frontend assets:
  - `src/frontend/app/app.html`
  - `src/frontend/pages/<page>/index.html|css|ts`
- `@webstir-io/webstir-frontend` available (installed via framework packages or as a dev dependency).

## Build a Static Frontend

From the workspace root:

```bash
webstir publish
```

What happens:
- `publish` runs the standard frontend/backend pipelines in production mode.
- In `webstir.mode: "ssg"` workspaces, the frontend defaults to SSG publish; use `--frontend-mode bundle` to override, or `--frontend-mode ssg` to opt in from other modes.
- The frontend provider creates optimized assets in `dist/frontend/**` and, in SSG publish mode, adds static-friendly aliases:
  - `dist/frontend/pages/<page>/index.html` (page HTML)
  - `dist/frontend/<page>/index.html` (pretty URL alias)
  - `dist/frontend/index.html` when `pages/home/index.html` exists.
- Publish injects small inline critical CSS blocks (app shell + docs layout) to reduce layout shifts; full stylesheets still load normally.

### Content Root (Markdown)

If you are using the Markdown content pipeline, the frontend provider needs to know where your `.md` files live:

- By default, it looks at `src/frontend/content/**`.
- You can override this with `src/frontend/frontend.config.json`:

  ```jsonc
  {
    "paths": {
      // relative to your workspace root
      "contentRoot": "docs"
    }
  }
  ```

With this override, Markdown under `<workspaceRoot>/docs/**` is converted into `/docs/...` routes during SSG publish.

## Static Paths from Module Metadata

You can describe SSG views in `package.json` under `webstir.moduleManifest.views`. SSG publish uses these hints to create additional `index.html` aliases and (when a backend view loader exists) generate per-page `view-data.json`.

Note: SSG routing is driven by `webstir.moduleManifest.views` (pages). Route entries under `webstir.moduleManifest.routes` are for backend APIs; if you add `renderMode`, `staticPaths`, or `ssg` metadata to routes, the frontend SSG publish step will fail and ask you to move that metadata to a view.

Example:

```jsonc
{
  "webstir": {
    "moduleManifest": {
      "views": [
        {
          "name": "HomeView",
          "path": "/",
          "staticPaths": ["/"]
        },
        {
          "name": "AboutView",
          "path": "/about",
          "staticPaths": ["/about", "/about/team"]
        }
      ]
    }
  }
}
```

Clean default (simple pages):

```jsonc
{
  "webstir": {
    "mode": "ssg",
    "moduleManifest": {
      "views": [
        { "name": "HomeView", "path": "/" },
        { "name": "AboutView", "path": "/about" }
      ]
    }
  }
}
```

Behavior today:
- Each `staticPaths` entry is treated as a URL path to alias.
- The first path segment is mapped to a page folder (for example, `/about` and `/about/team` map to `src/frontend/pages/about`).
- Root (`"/"`) maps to the `home` page when present.

In `webstir.mode: "ssg"` workspaces, views default to `renderMode: "ssg"` when omitted; set `renderMode` explicitly when you want to override (for example, `spa`).

For simple (non-parameterized) views, `staticPaths` is optional. When omitted in an `ssg` workspace, it defaults to `[path]`. Use `staticPaths` when you want extra aliases (like `/about/team`) or when a view has params (like `/blog/:slug`).

To scaffold a page and its SSG metadata in one step:

```bash
npx webstir-frontend add-page about --workspace "$PWD"
```

This:
- Creates `src/frontend/pages/about/index.html|css|ts`.
- In `webstir.mode: "ssg"` workspaces, no manifest entry is needed (paths are inferred from `src/frontend/pages/**`).
- Outside `ssg` mode, it ensures `webstir.moduleManifest.views` has an entry with `path: "/about"`, `renderMode: "ssg"`, and `staticPaths: ["/about"]`.

## GitHub Pages

GitHub Pages can serve the static `dist/frontend` output from a branch like `gh-pages`.

Basic flow:

```bash
webstir publish --frontend-mode ssg

mkdir -p .gh-pages && rm -rf .gh-pages/*
cp -R dist/frontend/* .gh-pages/
```

Then:
- Commit `.gh-pages` (or use a CI job to populate it).
- Push it to a branch configured for GitHub Pages (e.g., `gh-pages`).

Notes:
- Set the Pages root to the repository root when the branch only contains static assets.
- If you host the site under a subpath, adjust asset paths or configure your reverse proxy accordingly.

CI example (GitHub Actions, sketch only):

```yaml
name: Static Site (SSG)

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.5'

      - name: Build static site
        run: bun run webstir -- publish --workspace "$PWD"

      - name: Deploy to GitHub Pages
        run: |
          mkdir -p out
          cp -R dist/frontend/* out/
        # Replace this step with your preferred Pages deploy action
```

## S3 + CloudFront

You can upload the static assets to an S3 bucket and serve them via CloudFront.

High-level steps:

1. Build the static frontend:

   ```bash
   bun run webstir -- publish --workspace "$PWD"
   ```

2. Sync `dist/frontend/**` to your bucket (example using AWS CLI):

   ```bash
   aws s3 sync dist/frontend "s3://your-bucket-name" --delete
   ```

3. Configure CloudFront:
   - Origin: the S3 bucket (static website hosting or origin access as appropriate).
   - Default root object: `index.html`.
   - Optional: redirects or error responses for `/` and other routes depending on your URL structure.

Notes:
- `index.html` aliases created by `--frontend-mode ssg` allow `https://example.com/`, `https://example.com/about/`, etc., to resolve without custom routing rules.
- Set appropriate cache headers at upload or via CloudFront behaviors (e.g., long-lived caching for hashed assets, shorter for HTML).

## Current Status

- SSG support via `webstir publish --frontend-mode ssg` is an early preview and focuses on generating static HTML, per-page view data, and friendly URLs.
