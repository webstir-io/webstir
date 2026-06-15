# Webstir Portal

Docs hub for the Webstir ecosystem, built as a Webstir SSG workspace and deployed to GitHub Pages with the custom domain `webstir.io`. Content covers tutorials, how-to guides, reference material, and explanations.

## Run locally

- Prereq: Bun >= 1.3.11 and Node.js >= 20.18
- Install: `bun install`
- Build static site: `bun run build`
- Publish output: `dist/frontend/`

## Build & deploy

- CI build: `bun run --filter webstir-portal build`
- Deploy: GitHub Actions at `.github/workflows/deploy-docs.yml` builds on `main` and publishes `apps/portal/dist/frontend` to GitHub Pages.
- Custom domain: `src/frontend/public/CNAME`

## Structure

- App shell: `src/frontend/app/**`
- Static pages: `src/frontend/pages/**`
- Docs content: `src/frontend/content/**`
- Static root files: `src/frontend/public/**`
- Images: `src/frontend/images/**`

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md
