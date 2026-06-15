# Portal Webstir Migration Progress

## Goal

Migrate `apps/portal` from Docusaurus to Webstir SSG, preserve public docs URLs and GitHub Pages deployment, then deliver the change through PR merge without running manual release or publish scripts.

## Done

- Created the active migration execmap.
- Captured the current Docusaurus portal baseline.
- Recorded the Webstir portal UI direction.
- Converted `apps/portal` into a Webstir SSG workspace.
- Migrated docs content into `src/frontend/content`.
- Added reusable Webstir frontend support for public root assets, no-trailing-slash aliases, sitemap URL formatting, and source-relative docs links.
- Updated the docs deploy workflow to publish `apps/portal/dist/frontend`.
- Removed tracked Docusaurus portal source files.
- Fixed the repo tool contract tests to read migrated portal docs from `src/frontend/content`.
- Completed local cleanup, review, browser smoke, and required gate verification.

## Next

- Stage, commit, push, and open the delivery PR.

## Checks

- `bun run --filter webstir-portal build` passed for the current Docusaurus baseline.
- `bun run --filter @webstir-io/webstir-frontend build` passed after shared frontend changes.
- `bun test packages/tooling/webstir-frontend/tests/content-pages.test.js` passed.
- `bun test packages/tooling/webstir-frontend/tests/ssg-defaults.test.js` passed.
- `bun run --filter webstir-portal build` passed for the Webstir portal.
- Route parity script found 48 baseline routes and 0 missing Webstir `.html` aliases.
- Browser plugin tab attach failed twice; terminal Playwright smoke covered `/`, `/docs`, `/docs/tutorials/getting-started`, `/docs/reference/cli` at 390px, and `/404.html`.
- `git diff --check` passed.
- `execmap check plans/portal-webstir-migration/EXECMAP.md` passed with the known support-doc warnings.
- `bun run check:required` passed.

## Risks

- `execmap check` reports OK but warns on linked support docs because this repo keeps progress/baseline notes in the initiative folder.
- Live GitHub Pages verification is pending PR merge and deploy.

## Delivery state

Local branch verified: `codex/portal-webstir-migration`.

## Progress sync

- `plans/plan.md` points at `plans/portal-webstir-migration/EXECMAP.md`.
- `plans/portal-webstir-migration/EXECMAP.md` marks implementation, local proof, CI/deploy switch, and Docusaurus cleanup complete.
- `plans/portal-webstir-migration/02-ui-direction.md` records the narrow UI direction.
- Next sync due after PR/merge delivery if the deployment result changes the plan state.
