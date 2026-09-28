# Publish

`publish` produces optimized frontend assets plus the backend output needed to serve or deploy the application.

## Command

```bash
webstir publish --workspace /absolute/path/to/workspace
```

## Outputs

- `dist/frontend/**` for optimized document assets when the app has pages
- `build/backend/**` for compiled backend output when the app has a server

The app's layers decide the output shape. With a server, pages publish under `dist/frontend/pages/<page>/` and the server serves them. Without a server, the app publishes as a static site: `dist/frontend/<page>/index.html` and `dist/frontend/index.html`, with views rendered at publish (see [Static Sites](./static-sites.md)).

## Runtime Expectations

- Frontend assets are fingerprinted and rewritten for publish mode.
- Local stylesheet `url(...)` references are rebased when shared app CSS is flattened into page CSS.
- Page HTML references the browser-safe `index.js` entry name even when source is authored in `index.ts`; publish rewrites it to the fingerprinted bundle and rejects leftover source-file references or missing local document assets.
- Backend routes still own HTML, redirect, and fragment behavior.
- Request-time views continue to serve document HTML and expose `x-webstir-document-cache`.
- Fragment responses stay uncached and continue to emit `x-webstir-fragment-*` headers.

## Default Ship Path

For the main server-first lane:

1. Start from the `full` starter.
2. Validate the baseline document and form flow with `watch` and `test`.
3. Run `webstir publish --workspace "$PWD"`.
4. Deploy the published workspace with the Bun Docker contract from [Docker Deployment](./docker.md).

## Proof App Validation

Before changing docs or runtime behavior, confirm publish mode on the proof apps:

```bash
bun run publish:auth-crud
bun run publish:dashboard
```

Those two demos cover the shipped server-handled forms and dashboard refresh paths.

For static-site output, publish an app with pages and no server. The lower-level `webstir-frontend publish` package CLI decides from the same layers.

For published apps with a server, use the supported Bun Docker deployment contract described in [Docker Deployment](./docker.md). Webstir is still experimental overall, but that Bun path is the one deploy shape this repo currently supports and tests.

## Related Docs

- [Watch](./watch.md)
- [Test](./test.md)
- [Workflows](../reference/workflows.md)
