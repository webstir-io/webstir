# AGENTS.md

Monorepo baseline for Webstir.

## Layout
- `packages/contracts/*`: canonical publishable contract packages.
- `packages/tooling/*`: canonical publishable TypeScript framework/tooling packages.
- `apps/portal`: first-party docs app workspace.
- `examples/demos/*`: example workspaces used to verify framework behavior.

## Source Of Truth
- Prefer editing `packages/**` when changing the publishable TypeScript packages.
- When docs refer to repo paths, prefer the monorepo layout above rather than the legacy single-repo names.

## Code Size
- Keep each file to one responsibility. Split a file when it takes on a second one, not because of its length; a split that scatters one flow across files makes it harder to follow.

## Validation
- JS/TS work: use `bun` from the repo root when possible.
- Prefer package-local validation first, then widen to repo-level checks when the change warrants it.

## Path-Specific Notes
### `packages/tooling/webstir-backend`
- Use `bun run build` for small changes.
- Use `bun run smoke` for scaffold or template changes.
- Release prep: `bun run build && bun run smoke && bun run test`.

### `packages/tooling/webstir-frontend`
- Start with `README.md` and the package exports before changing public surfaces.
- Validate with `bun run build` and `bun run test`; use the repo required gate for cross-package changes.
- The published tarball ships `src/`, `scripts/`, `tests/`, and `tsconfig.json`; keep them publish-ready.
- A change to a published package adds a changeset (`bun run changeset`); releases are versioned and published by Changesets.

## Delivery
- **Gate:** `bun run build && bun run test`; add `bun run --filter @webstir-io/webstir-backend smoke` for scaffold or template changes. CI's `Required Gate` runs the same.
- **While iterating:** `bun run --filter <pkg> build && bun run --filter <pkg> test`, or a single `bun test <file>` after a build.
- **Review focus:** the Code Review Rules below. Fix each finding as a class: find its siblings (the same pattern elsewhere, the same rule in other shapes) and cover them with one table-driven test.
- **Sensitive areas** (always a full review): rendered HTML and templates, views and routing, sessions and forms, `module-contract` and other public APIs, generated client copies, release tooling.
- **Merge:** squash PR into `main`; required checks: `Required Gate`; review threads must be resolved.
- **Go live:** the docs site deploys itself on every push to `main` (`Deploy Docs`). Packages: a pull request that changes a published package includes a changeset (`bun run changeset`: the packages and a patch, minor or major bump; the four `webstir` packages and the testing pair each version together). On `main`, the `Release Package` workflow keeps a "Version packages" pull request up to date; merging it publishes to npm with provenance and tags each package. Chris decides when to release by merging that pull request.
- **Verify live:** for a release, `npm view <pkg>@latest version` prints the new version for every package in the group (the workflow checks each published version on npm too); for docs, the `Deploy Docs` run for the merge commit succeeded and webstir.dev shows the change.
- **Deploy policy:** automatic.
- Plan large work whole, but deliver it in layers so each review sees a few hundred lines. Start each layer's branch from `main` after the previous layer merges; stacking one branch on another conflicts once the first is squash-merged.

## Code Review Rules
- Rendered HTML: every bound value must be escaped; URL attributes must block unsafe schemes; POST forms rendered with a session carry the CSRF field; `*.program.json` files must never be served, however the path is spelled.
- Views: a view that names a `page` must run its loader on every request, so a `redirect()` or `notFound()` in it cannot be bypassed by serving the template as a file.
- Sessions and forms: signing in must renew the session id; flash is delivered once, to a rendered page; a failed form re-renders at the page's own address.
- Build-time checks fail loudly with file and line rather than shipping placeholders or silently dropping a binding.
- Contract-first: `webstir-frontend` never imports `webstir-backend`; shared runtime code lives in `module-contract`.
- Generated copies (`orchestrators/bun/assets/**`) must match their `orchestrators/bun/resources/**` sources. Client-nav, search and content-nav are not copied: they live in `packages/tooling/webstir-frontend/src/features/` and apps import `@webstir-io/webstir-frontend/features/<name>` (and its `.css` from app.css).
- New behavior needs a test; package tests run against `dist/`, so they must pass after a build.
