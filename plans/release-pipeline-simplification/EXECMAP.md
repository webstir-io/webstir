# Release Pipeline Simplification Execmap

## Goal

Make Webstir validation and package publishing fast, deterministic, resumable, and operable as one release instead of a sequence of package-specific ceremonies.

## Guardrails

- Do not bump package versions, create release tags, or publish packages while changing the pipeline.
- Keep `.github/workflows/release-package.yml` as the trusted-publishing workflow filename.
- Publish only from an exact commit on `main` whose required CI gate succeeded.
- Preserve meaningful contract, integration, browser, packaging, and installation coverage while removing duplicate execution.
- Build each release package once and never interpret authentication, timeout, or registry-server errors as an unpublished version.
- Keep the release workflow safe to rerun after partial completion.
- Prefer existing Bun tooling and small repository-owned scripts over adding a release framework.

## Execution Map

- [x] Baseline the current CI and release execution graph.
  - Confirm PR and `main` run the same required gate.
  - Identify repeated builds, tests, smoke checks, audit calls, and one-file test processes.
  - Record the partial-publication and transient-registry failure modes from the latest release.

- [x] Make package publishing one exact-SHA-gated, idempotent release-set workflow.
  - Select one configured, synchronized package group and validate it from the package graph.
  - Build each selected package once and publish in dependency order.
  - Remove audit, browser installation, tests, and smoke checks already proven by CI.
  - Distinguish unpublished versions from registry transport, authorization, and partial-publication failures.
  - Verify registry metadata, provenance, `gitHead`, and clean installation after publishing.
  - Keep a no-publish planning mode for local and CI verification.

- [x] Verify and deliver the publishing workflow repair.
  - Run focused release-tool tests and workflow/config checks.
  - Run the repository-required gate.
  - Review and deliver the first PR without creating a release tag or publishing a package.

- [ ] Simplify the CI execution graph without weakening product coverage.
  - Build affected package layers once rather than inside nested test and smoke scripts.
  - Group compatible test files while retaining isolation for suites that require it.
  - Remove no-op smoke scripts, redundant command aliases, and unconsumed coverage artifacts.
  - Run browser, installation, audit, and benchmark lanes only at their relevant boundaries.
  - Align testing documentation with the remaining commands and gates.

- [ ] Verify and deliver the CI simplification.
  - Run focused package and orchestration tests first, then the resulting required gate.
  - Compare the test inventory and wall-clock behavior before and after.
  - Review and deliver the second PR without publishing packages.
  - Close the active plan after the merged workflow checks pass.

## Done When

- One release action validates and publishes the selected compatible package set in dependency order.
- Publishing trusts the exact successful CI revision instead of repeating the full validation suite.
- Registry failures have distinct actionable diagnoses and a rerun safely resumes completed work.
- CI builds package layers once, retains meaningful behavior coverage, and removes redundant ceremony.
- Documentation names one required validation path and one release path.
- Both cleanup PRs merge with green checks and no package release occurs as part of the cleanup.
