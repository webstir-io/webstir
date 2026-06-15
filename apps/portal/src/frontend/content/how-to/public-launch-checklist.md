# Public Launch & Repo Pattern

Make Webstir repos public in a consistent, OSS-friendly way. This guide captures the expectations for docs, GitHub features, and repo layout when flipping visibility or creating new repos.

## Purpose
- Provide a single checklist for public launches.
- Keep docs, CI, and community health consistent across repos.
- Avoid duplicating org-wide `.github` files.

## When To Use
- Before making an existing private repo public.
- When creating a new repo in the `webstir-io` org.
- When auditing repos for OSS readiness.

## README Checklist (Per Repo)
- Clear title and one-line value statement.
- **Status** section near the top:
  - Explicitly mark Webstir as experimental / learning-focused.
  - Call out that APIs, contracts, and workflows may change between releases.
  - Suggest not using it for production workloads yet.
- Quick Start:
  - Install instructions (Bun or npm plus any required env vars).
  - Minimal usage example (CLI or code snippet).
  - Version requirements (Bun, Node, TypeScript, etc.).
- Concepts / Layout:
  - Brief description of expected workspace or usage patterns.
  - Links into `webstir-portal` docs where applicable.
- Maintainer Workflow:
  - How to run `build`, `test`, and any local smoke checks.
  - Reference to CI workflows if relevant.
- Community & Support:
  - Code of Conduct: `https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md`
  - Contributing: `https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md` (plus repo-local `CONTRIBUTING.md` when present).
  - Security: `https://github.com/webstir-io/.github/blob/main/SECURITY.md`
  - Support: `https://github.com/webstir-io/.github/blob/main/SUPPORT.md`

## .github Pattern (Per Repo)
- Always include:
  - `workflows/ci.yml` — run build and tests on PRs and pushes.
  - `workflows/release.yml` — handle tagging and publish automation.
- Optional, when needed:
  - `CODEOWNERS` — for repos that need explicit ownership or auto-reviewers.
  - `pull_request_template.md` — when this repo has PR expectations that differ from the default.
- Do **not** duplicate:
  - `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md` — rely on the central `.github` repo and link from README instead.

## GitHub Settings Checklist
- Topics:
  - Add relevant topics (for example: `web-framework`, `bun`, `typescript`, `frontend`, `backend`, `testing`, `vite`, `agentic-assistants`).
- Branch protection:
  - Require PRs into the default branch.
  - Require status checks from `ci` workflows to pass.
  - Optionally require at least one approving review.
- Default branch:
  - Confirm the default branch (`main`) is set correctly.
- Repo description:
  - Short, plain-language description that matches the README one-liner.

## CI & Release Expectations
- CI (`ci.yml`):
  - Bun/Node repos: `bun install`, `bun run build`, `bun run test`, and package-local smoke checks when present.
  - Ensure CI runs on PRs and pushes to the default branch.
- Release (`release.yml`):
  - Use a consistent strategy (tags, GitHub Releases, or package publish).
  - Ensure the workflow is idempotent and uses the same build/test commands as CI.

## Adding a New Repo
1. Scaffold the code and initial `README.md`.
2. Create `.github/workflows/ci.yml` and `.github/workflows/release.yml` based on an existing repo in the same language.
3. Add a **Status** section and **Community & Support** block to the README.
4. Set topics, description, and branch protection in GitHub settings.
5. Link back to `webstir-portal` docs where appropriate (tutorials, reference, or explanations).

## Related Docs
- Docs index — [docs/README.md](../README.md)
- CLI reference — [CLI](../reference/cli.md)
- Contracts & invariants — [Contracts](../reference/contracts.md)
- Provider selection — [Provider selection](./provider-selection.md)
