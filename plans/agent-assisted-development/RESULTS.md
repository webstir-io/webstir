# Agent-assisted development evaluation

Evaluation date: September 23, 2026 (Pacific). This is a small local before/after experiment on Webstir, not a comparison with other frameworks.

## Method

- Baseline: registry `@webstir-io/webstir@0.1.65`.
- Candidate: a standalone tarball built from this change, installed outside the repository. Its package version remains `0.1.65`; SHA-256 `e91c165ec469f6afcb5c91c011be77850c1ecb281d18bb01ce5392051498d022` distinguishes it from the registry release. It is not published to npm.
- Agent: Codex CLI `0.156.1`, `gpt-6-astra`, reasoning effort `high`, Bun `1.4.1`. Each attempt uses a fresh ephemeral session with an eight-minute agent budget, workspace-write sandbox, and network access for dependencies and local servers.
- Three attempts each at building a notes app, extending an authenticated notes app with status/filtering, and repairing a seeded edit defect plus scaffold drift. A separate delete-defect variation is the candidate holdout.
- Each task campaign runs its attempts sequentially; the three campaigns run concurrently on the same host. Task prompts, fixtures, agent settings, and budgets are fixed. No human hints or retries are supplied inside an attempt.
- Agent elapsed time includes its own setup, exploration, coding, and checks. Evaluator installation/fixture setup and independent grading time are excluded. Usage is recorded when the CLI reports it; no dollar-cost estimate is inferred.
- Independent checks build and test the app, exercise native forms with JavaScript disabled, reject invalid writes, and check persistence across restart. Authenticated tasks also check anonymous writes, CSRF, and cross-owner access. Repair checks the retained customization and restored framework file. An additional browser with JavaScript enabled checks rendering.

The known-good fixture passes the oracle. Both deliberately broken repair fixtures pass their original app tests but fail the independent CRUD and managed-file checks. An agent's completion message alone cannot produce a passing score. Timeouts, agent failures, and environment failures remain in the denominator.

## Scorer correction and evidence preservation

The original evaluator used an exact text-label locator for the status filter. Playwright included nested option text for a valid implicit label, incorrectly failing the filter check. The corrected evaluator uses the combobox's accessible role and name. All original baseline attempts finished unchanged before correction; every retained app is regraded in a fresh copy with fresh test data. Original results and agent timing remain intact, and source/config hashes are checked before and after grading.

Runner hardening also prevents accidental overwrite of an existing run, bounds readiness requests to unresponsive apps, and records dependency versions through the CLI's actual package resolution (including bundled dependencies). These changes do not alter task requirements or agent inputs.

Original v1 fingerprint: `517060c1d57c919f96ddbe8e5fc1c326d268658256df85fa8f3b9af47d95c58e`. Corrected v2 fingerprint: `7bb25790148af446ee374d0d7da503f95d6f13403b33f215250044f75e06d0e9`.

All nine baseline artifacts pass v2, with every original/copy source hash unchanged. In v1, the three extension attempts failed only the invalid selector; the six other attempts passed. Those original outcomes remain recorded alongside the corrected results.

## Results

The candidate sample is running. Baseline results below use the uniformly corrected evaluator; elapsed times are the original agent times in seconds.

| Task | Baseline completions | Baseline attempts (seconds) | Baseline median |
| --- | --- | --- | --- |
| Build | 3/3 | 282.502, 249.100, 318.555 | 282.502 |
| Extend | 3/3 | 203.888, 198.407, 199.985 | 199.985 |
| Repair | 3/3 | 178.564, 183.514, 182.098 | 182.098 |

Baseline totals: 9/9 correct, zero human interventions, zero retries, 4,477,644 input tokens (including 4,094,848 cached input), 55,691 output tokens, and 6,193 reported reasoning-output tokens. Cached and reasoning counts are components, not additional totals to sum into input/output.

## Observed friction and shipped changes

1. Failed backend builds discarded compiler details, requiring agents to run TypeScript separately. Build and structured validation now preserve the file location and compiler diagnostic while keeping the failing exit status.
2. Repair restored deleted starter-demo tests after an app had replaced those routes. Starter tests are now app-owned after initialization; repair still restores required framework support files.
3. Agents explored installed package internals to understand feature wiring. New apps receive concise instructions; CLI help and initialization locate the installed setup guide and two complete recipes.
4. Route scaffolding records metadata without creating a handler. CLI, structured agent output, MCP descriptions, and documentation now state that boundary explicitly.

The recipes cover persisted native forms and authenticated status/filtering. Separate consumer and browser tests check validation, escaping, CSRF, owner isolation, migration, and restart persistence. Database initialization is lazy: build/inspection imports do not create or migrate storage.

Fresh candidate installation proof verified actual installed guide paths, generated instructions, source-located failures in CLI and structured validation, and a notes app copied from the installed recipe. That app used registry dependencies without monorepo links and passed nine tests. Three recipe browser/consumer tests passed 50 assertions. The homepage and tutorial were also inspected at desktop and mobile sizes; the new tutorial link worked and the browser reported no console errors.

The full required repository gate passed, including 193 core orchestrator tests, 26 browser tests, package builds/tests and installation smoke, and the portal build. Earlier gate attempts found an updated test-inventory count and two intermittent deployment-test startup failures. The exact preserved failed fixture and subsequent backend/full-gate runs passed; the original cause is unproven. A test-only change retains child-process output for future startup failures. Candidate product code was unchanged during these checks.

## Limits and public claims

- The sample is small, tasks are narrow, and one model/integration is exercised. A passing result means the listed checks passed; it does not establish production readiness or exhaustive security.
- The extension oracle does not seed legacy records or independently test omitted-status defaults. Its status test supplies an explicit value. Recipe migration tests provide separate evidence, not a replacement for this missing agent-task coverage.
- Authorization checks cover anonymous writes, CSRF, and another user's reads/writes. They do not independently cover every anonymous-read or incorrect-password path.
- Personal CLI configuration is excluded, but this host still exposes generic user skills. Baseline repair attempts read the debug skill; candidate attempts also discovered the Playwright skill. The same skills were available, but their use varied. Trace inspection checks for forbidden framework-checkout, evaluator, other-run access, or installed-package edits; this is not a hermetic agent environment.
- Sandbox temporary-directory and process-list permission errors occurred during baseline work. They are environment friction and remain included in the agents' elapsed time.
- Candidate CLI dependencies are bundled from the checkout. Generated applications install their declared registry dependencies; the changed backend component is the CLI's build tooling. This is a packaged candidate trial, not a post-publication registry smoke.
- A separate `0.1.66` release landed during the trials. Compatible app dependency ranges resolved `0.1.65` for all baseline apps and some candidate apps, then `0.1.66` for later candidate apps. Actual app versions are recorded per attempt. Upstream commit `b8aba02` changes only version/range metadata in the backend, frontend, and module-contract packages; its behavior change is in the CLI static-site server, outside the fixed candidate artifact. Nevertheless, this is not a fully version-frozen installation comparison, and the timings do not establish causation or a speed claim.

Public copy uses the capability statement “Build HTML-first apps with AI coding agents.” It does not claim a measured speedup, superiority to another framework, or support for untested integrations.

## Release verification checklist

Package publication is separate from this implementation and GitHub merge.

- Prepare the synchronized package release through the repository's documented release workflow.
- Verify the release's registry versions, source revision, and provenance.
- From a fresh registry install outside this repository, verify generated instructions and installed recipe paths, build a recipe app, and check compiler diagnostics and repair preservation.
- Recheck the public tutorial against the published version, then update its availability wording.
- Repeat the frozen task sample before adding any comparative performance claim; report the comparator, full outcomes, settings, and limitations.

Reproduction commands and evaluation code live in [tools/agent-eval](../../tools/agent-eval/README.md). Raw local traces and application artifacts are retained outside the repository; this report contains sanitized results only.
