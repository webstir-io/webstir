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
- Prefer keeping code files to about 500 lines or fewer when practical.
- Split large files by responsibility when it improves clarity; do not force file splits that make the code harder to follow.

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
- Prepare synchronized production releases from the repo root with `bun run release:prepare -- webstir <patch|minor|major|x.y.z>`.

## Releasing
- Prepare on a branch: `bun run release:prepare -- webstir <patch|minor|major|x.y.z>` (use `testing` for the testing pair), then open a PR. `apps/portal/src/frontend/content/how-to/framework-packages.md` has the full flow.
- Merge only after Codex's GitHub review is done (see Review Loop), CI is green, and the maintainer has said to merge.
- After the merge commit passes `main` CI, push `release-set/<group>/v<version>`; the Release Package workflow publishes to npm. Confirm the new versions on the registry before calling the release done.

## Review Loop
- Before opening a PR, review the diff for failure cases in the areas below and run `codex review --base main`; the PR's own review should come back close to clean.
- Fix each finding as a class: find its siblings (the same pattern elsewhere, the same rule in other shapes) and cover them with one table-driven test.
- A review is done when no P1 findings remain, every P2 is fixed or answered with a reason, and the last round found only edge cases.
- Plan large work whole, but open a PR per layer so each review sees a few hundred lines.

## Code Review Rules
- Rendered HTML: every bound value must be escaped; URL attributes must block unsafe schemes; POST forms rendered with a session carry the CSRF field; `*.program.json` files must never be served, however the path is spelled.
- Views: a view that names a `page` must run its loader on every request, so a `redirect()` or `notFound()` in it cannot be bypassed by serving the template as a file.
- Sessions and forms: signing in must renew the session id; flash is delivered once, to a rendered page; a failed form re-renders at the page's own address.
- Build-time checks fail loudly with file and line rather than shipping placeholders or silently dropping a binding.
- Contract-first: `webstir-frontend` never imports `webstir-backend`; shared runtime code lives in `module-contract`.
- Generated copies (`orchestrators/bun/assets/**`, demo and portal `client-nav.ts`/`form-enhancement.ts`) must match their `orchestrators/bun/resources/**` sources.
- New behavior needs a test; package tests run against `dist/`, so they must pass after a build.
