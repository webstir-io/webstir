# Static Sites

Build and deploy a static frontend using an `ssg` workspace or the lower-level frontend package CLI.

See also: [CSS Playbook](./css-playbook.md) for the minimal, convention-first styling approach used by the SSG starter.

## Supported Paths

- Top-level Bun CLI: scaffold an `ssg` workspace, then run `webstir publish --workspace <path>`.
- Lower-level package CLI: run `webstir-frontend publish --workspace <path> --mode ssg` when you are working directly with the frontend package.

The top-level `webstir` CLI does not currently expose a `--frontend-mode` switch.

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

1. Build the static frontend:

```bash
webstir publish --workspace "$PWD"
```

2. Sync `dist/frontend/**` to your bucket:

```bash
aws s3 sync dist/frontend "s3://your-bucket-name" --delete
```

3. Configure your CDN to serve `index.html` as the default object and cache hashed assets aggressively.
