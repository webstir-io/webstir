# Static Sites

Build and deploy a static site: an app with pages (`src/frontend`) and no server (`src/backend/index.ts`). Such an app publishes as files any static host serves.

See also: [CSS Playbook](./css-playbook.md) for the minimal, convention-first styling approach used by the SSG starter.

## Supported Paths

- Top-level Bun CLI: `webstir publish --workspace <path>` on an app without a server.
- Lower-level package CLI: `webstir-frontend publish --workspace <path>` when you are working directly with the frontend package. It reads the same layers.

## Recommended Flow

```bash
webstir init ssg site
cd site
bun install
webstir publish --workspace "$PWD"
```

What happens:

- The frontend provider writes optimized assets to `dist/frontend/**`.
- Publish writes the static layout:
  - `dist/frontend/<page>/index.html`
  - `dist/frontend/index.html` for the `home` page

## Advanced Package-Level Flow

If you are testing the frontend package directly:

```bash
bunx webstir-frontend publish --workspace "$PWD"
```

Use this path when you need package-level control without going through the top-level orchestrator. It accepts and ignores the `--mode` option older deploy scripts pass.

## Pages Rendered from Data

A page template can bind data with `data-text`, `data-attr-*`, `data-if`, `data-each`, and `data-include`, the same template language a server renders on each request. Without a server the rendering happens once, at publish: a view in `src/backend/module.ts` names the page, the addresses to publish, a zod schema for its data, and a loader.

```ts
import { z } from 'zod';

export const module = {
  views: [
    {
      definition: {
        name: 'post',
        path: '/blog/:slug',
        page: 'post',
        staticPaths: ['/blog/hello', '/blog/launch'],
      },
      data: z.object({ title: z.string(), tags: z.array(z.string()) }),
      load: ({ params }) => readPost(params.slug),
    },
  ],
};
```

```html
<!-- src/frontend/pages/post/index.html -->
<head><title data-text="title">Post</title></head>
<main>
  <h1 data-text="title">A post</h1>
  <ul><li data-each="tags as tag" data-text="tag">tag</li></ul>
</main>
```

What happens:

- `webstir publish` compiles the module (no server is built), runs each loader for each static path, checks the result against the schema, and writes finished HTML to `dist/frontend/blog/hello/index.html` and `dist/frontend/blog/launch/index.html`.
- The build fails with the file and line when a template binds a path the schema does not have, when a page has bindings no view renders, or when a loader returns data that does not match its schema.
- A parameterized path needs `staticPaths`: a static site publishes only the addresses it names.
- The page's own address (`/post/`) is not published, since the bare template holds placeholder content; neither are the compiled `*.program.json` files.
- POST forms render without a CSRF field, because a static site has no session. Point them at a service that accepts them.
- `webstir watch` serves the same pages, rendered after each change to a template or to the module.

A page renders where its data comes from: at publish, from a view, or in the browser, from a `data.ts` beside the page. A page with bindings that no view names and that has no `data.ts` fails build, watch, and publish with the file and line. An app with a server renders its views per request instead.

## Static Paths from Module Metadata

You can describe SSG views in `package.json` under `webstir.moduleManifest.views`. SSG publish uses these hints to create additional `index.html` aliases and, for views with a loader that do not name a `page`, generate per-page `view-data.json`.

Example:

```jsonc
{
  "webstir": {
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
- In apps without a server, omitted `renderMode` values default to `ssg`.
- `staticPaths` is optional for simple views and useful when you want extra aliases such as `/about/team`.

## Pages at Addresses Known Only at Runtime

A view that names a `page` shows that page at its path pattern, as a page route:

```jsonc
{
  "webstir": {
    "moduleManifest": {
      "views": [
        { "name": "item", "path": "/items/:id", "page": "items" },
        { "name": "featured", "path": "/featured", "page": "items" }
      ]
    }
  }
}
```

The page's script reads the address (`url` in `load` and `setup`), for example to fetch item 42 for `/items/42`.

A static host only serves files, so publish writes what each host needs:

- A pattern without parameters (`/featured`) gets the page's HTML as a file at that address.
- A pattern with parameters (`/items/:id`) can't have a file per address, so publish writes two fallbacks:
  - a `_redirects` rewrite, which Netlify and Cloudflare Pages serve with a 200. The app's own `_redirects` rules come first.
  - a `404.html` that loads the routed page in place, keeping the address, and shows the not-found page for any other address. GitHub Pages serves it on its own. S3 + CloudFront needs the error responses below.

On a host without rewrites, a routed address answers with a 404 status while showing its page.

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

Add a `404` page to the workspace and point the distribution's custom error responses for 403 and 404 at `/404.html`, with response code 404. That is also what shows a page at an address a view routes to (see above). The 404 page is excluded from the sitemap automatically, and `webstir watch` serves it with a 404 status for any page address that does not exist, so you can see it locally.
