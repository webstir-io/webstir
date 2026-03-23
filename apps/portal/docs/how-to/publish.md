# Publish

`publish` produces optimized frontend assets plus the backend output needed to serve or deploy the application.

## Command

```bash
webstir publish --workspace /absolute/path/to/workspace
```

## Outputs

- `dist/frontend/**` for optimized document assets when the workspace has a frontend surface
- `build/backend/**` for compiled backend output when the workspace has a backend surface

## Runtime Expectations

- Frontend assets are fingerprinted and rewritten for publish mode.
- Backend routes still own HTML, redirect, and fragment behavior.
- Request-time views continue to serve document HTML and expose `x-webstir-document-cache`.
- Fragment responses stay uncached and continue to emit `x-webstir-fragment-*` headers.

## Proof App Validation

Before changing docs or runtime behavior, confirm publish mode on the proof apps:

```bash
bun run publish:auth-crud
bun run publish:dashboard
```

Those two demos cover the shipped server-handled forms and dashboard refresh paths.

For static-site output, scaffold an `ssg` workspace, or keep the current workspace mode and force SSG publish with `webstir publish --workspace /absolute/path/to/workspace --frontend-mode ssg`. The lower-level `webstir-frontend publish --mode ssg` package CLI still works directly when you need package-level control.

For a local production-style preview of a published workspace, use the Bun-owned sandbox helper at `orchestrators/bun/assets/deployment/sandbox/docker-compose.yml` with `WEBSTIR_WORKSPACE=/absolute/path/to/workspace`.

## Related Docs

- [Watch](./watch.md)
- [Test](./test.md)
- [Workflows](../reference/workflows.md)
