# Static Sites

Build and deploy a static frontend using an `ssg` workspace or the lower-level frontend package CLI.

See also: [CSS Playbook](./css-playbook.md) for the minimal, convention-first styling approach used by the SSG starter.

## Supported Paths

- Top-level Bun CLI: scaffold an `ssg` workspace, or override a publish run with `webstir publish --workspace <path> --frontend-mode ssg`.
- Lower-level package CLI: run `webstir-frontend publish --workspace <path> --mode ssg` when you are working directly with the frontend package.

## Recommended Flow

```bash
webstir init ssg site
cd site
bun install
webstir publish --workspace "$PWD"
```

What happens:

- The frontend provider writes optimized assets to `dist/frontend/**`.
- SSG publish creates static-friendly aliases:
  - `dist/frontend/pages/<page>/index.html`
  - `dist/frontend/<page>/index.html`
  - `dist/frontend/index.html` when `pages/home/index.html` exists
- Publish injects the same optimized HTML/CSS/JS output used by the `ssg` demo workspaces.

## Advanced Package-Level Flow

If you are testing the frontend package directly:

```bash
bunx webstir-frontend publish --workspace "$PWD" --mode ssg
```

Use this path when you need package-level control without going through the top-level orchestrator.

If you are using the top-level CLI against a non-`ssg` workspace, the equivalent override is `webstir publish --workspace "$PWD" --frontend-mode ssg`.

## Static Paths from Module Metadata

You can describe SSG views in `package.json` under `webstir.moduleManifest.views`. SSG publish uses these hints to create additional `index.html` aliases and, when a backend view loader exists, generate per-page `view-data.json`.

Example:

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

Notes:

- `routes` metadata is for backend APIs, not SSG page generation.
- In `ssg` workspaces, omitted `renderMode` values default to `ssg`.
- `staticPaths` is optional for simple views and useful when you want extra aliases such as `/about/team`.

## GitHub Pages

```bash
webstir publish --workspace "$PWD"

mkdir -p out
cp -R dist/frontend/* out/
```

Then publish `out/` with your preferred Pages workflow.

## S3 + CloudFront

Scaffold the deploy script, edge function, and workflow:

```bash
webstir enable s3-cloudfront --workspace "$PWD"
S3_BUCKET=your-bucket-name CLOUDFRONT_DISTRIBUTION_ID=E123EXAMPLE bun run deploy
```

The script publishes, syncs `dist/frontend/**` to the bucket with long-lived caching for fingerprinted bundles and revalidation for documents, and invalidates the distribution. See [Enable Features](./enable.md#s3-cloudfront) for what it writes.

### Directory URLs need an edge rewrite

Publish output is directory-based (`/about/` is `about/index.html`). CloudFront's `DefaultRootObject` only covers `/`. When the origin is the S3 REST endpoint (the default when you pick a bucket in the CloudFront console, and the only option with Origin Access Control), every other page returns 404, because the REST endpoint serves exact object keys and never maps a directory to its index file.

Attach the generated `utils/cloudfront-rewrite-directory-index.js` as a CloudFront Function on the distribution's default behavior, viewer-request event. It rewrites `/about/` and `/about` to `/about/index.html` and leaves file requests alone. Only the S3 *website* endpoint resolves directory indexes on its own, and that endpoint is HTTP-only and cannot use Origin Access Control.

### Error pages

Add a `404` page to the workspace and point the distribution's custom error responses for 403 and 404 at `/404/index.html`. The 404 page is excluded from the sitemap automatically, and `webstir watch` serves it with a 404 status for any page address that does not exist, so you can see it locally.
