# Portal Webstir Migration Execmap

## Goal

Replace the Docusaurus-powered `apps/portal` site with a first-party Webstir SSG portal while preserving public docs URLs, GitHub Pages deployment, and the current documentation content.

## Guardrails

- Treat this as Webstir dogfooding: framework gaps should become focused `packages/tooling/webstir-frontend` improvements, not one-off portal hacks.
- Preserve the public hosting contract: `webstir.io`, GitHub Pages artifact deploy, `CNAME`, sitemap, static assets, and existing docs entry URLs.
- Keep the current Docusaurus portal behavior available until the Webstir build has a local publish proof and a URL parity check.
- Prefer the existing SSG docs/content pipeline and `examples/demos/ssg/site` patterns before inventing new portal-specific machinery.
- Do not edit `orchestrators/dotnet/**`; it is archival unless the task explicitly becomes .NET maintenance.
- Avoid importing React, MDX, or Docusaurus compatibility layers unless a concrete content requirement proves they are needed.
- Keep portal design work restrained and docs-first; do not let the migration become a broad redesign.
- Validate locally before changing deploy output, then verify CI and Pages after the deploy workflow changes.

## Execution Map

- [x] Baseline the current portal contract.
  - Step doc: [01-baseline.md](./01-baseline.md).
  - Record the current Docusaurus routes, especially `/`, `/docs/`, tutorial/how-to/reference/explanation pages, no-trailing-slash behavior, generated sitemap, static assets, and `CNAME`.
  - Build the current portal once with `bun run --filter webstir-portal build` so there is a concrete parity target.
  - Identify every Docusaurus-only feature currently in use: sidebars, edit links, last-update metadata, color mode, code highlighting, admonitions, MDX components, and navbar/footer links.

Progress record: [00-progress.md](./00-progress.md).

- [x] Define the Webstir portal shape inside `apps/portal`.
  - Convert `apps/portal/package.json` scripts and dependencies from Docusaurus to workspace-local Webstir packages.
  - Create the Webstir SSG app structure under `apps/portal/src/frontend/**`.
  - Port the current homepage into `src/frontend/pages/home/` with equivalent primary links and brand assets.
  - Port the docs hub shell into `src/frontend/pages/docs/` using the existing SSG docs layout, nav, content-nav, search, and theme patterns where useful.
  - Carry over `static/img/**` and `static/CNAME` into the Webstir static asset flow without changing public asset URLs unless the parity audit says they are unused.

- [x] Migrate Markdown content with route parity.
  - Move or copy `apps/portal/docs/**` into the Webstir content root.
  - Preserve current public docs paths, including section index pages such as `/docs/tutorials/`, `/docs/how-to/`, `/docs/reference/`, and `/docs/explanations/`.
  - Resolve Docusaurus `README.md` behavior explicitly, because Webstir reserves `/docs/` for the docs landing page and maps nested README files to section indexes.
  - Add sidebar override metadata where ordering or labels need to match the current portal.
  - Convert or remove any Docusaurus-only Markdown syntax found during migration.

- [x] Close framework gaps in the shared Webstir docs pipeline.
  - Add focused `packages/tooling/webstir-frontend` behavior only where portal parity exposes a reusable gap.
  - Likely candidates: trailing-slash/no-trailing-slash aliases, edit-link metadata, better section ordering, code block highlighting parity, sitemap/base URL details, and generated search/nav data.
  - Cover any shared pipeline change with package-level tests before relying on it in the portal.

- [x] Prove the Webstir portal locally before removing Docusaurus.
  - Run the portal Webstir publish path and inspect `apps/portal/dist/frontend`.
  - Run link validation from Webstir publish output and fix broken internal links or anchors.
  - Smoke the local static output in a browser for `/`, `/docs/`, representative content pages, mobile navigation, theme toggle, search if enabled, and missing-page behavior.
  - Compare generated route inventory against the Docusaurus baseline and document any intentional URL changes.

- [x] Switch CI and deployment.
  - Update `.github/workflows/ci.yml` to build the Webstir portal.
  - Update `.github/workflows/deploy-docs.yml` to upload the Webstir static output path instead of `apps/portal/build`.
  - Ensure the Pages artifact includes `CNAME`, `sitemap.xml`, robots metadata if generated, images, CSS, JS, and docs HTML.
  - Keep deployment branch and GitHub Pages environment unchanged.

- [x] Remove Docusaurus residue after the Webstir path is proven.
  - Delete Docusaurus config, sidebars, Babel config, generated `.docusaurus`, and Docusaurus dependencies.
  - Update `apps/portal/README.md` and docs references that still say the portal is Docusaurus-based.
  - Update any utility docs that mention `bun run --filter webstir-portal build` only if the command semantics change.
  - Run a stale-text scan for `docusaurus`, `apps/portal/build`, and old route assumptions.

- [x] Final verification and handoff.
  - Run the cheapest reliable focused checks first, then the repo-level required gate if shared tooling changed.
  - At minimum verify portal publish, package tests for any shared frontend changes, `git diff --check`, and `bun run check:required` when practical.
  - If deployed, verify the live GitHub Pages URL and `https://webstir.io` health by fetching representative pages.
  - Update this execmap and `plans/plan.md` with the final status before delivery.

## Done When

- `apps/portal` no longer depends on Docusaurus and builds/publishes through Webstir SSG.
- The published portal preserves the current public docs URL contract or documents intentional changes with redirects/aliases where needed.
- GitHub Actions builds and deploys the Webstir static output to GitHub Pages with the existing `webstir.io` custom domain.
- Markdown docs, homepage, navigation, search/content navigation if retained, static assets, sitemap, and CNAME are present in the Webstir output.
- Shared Webstir pipeline changes made for the portal are covered by focused tests.
- Docusaurus configs, generated files, and stale docs references are removed.
- The final verification set passes or any skipped verification is explicitly explained.
