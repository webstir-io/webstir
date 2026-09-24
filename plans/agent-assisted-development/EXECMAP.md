# Agent-assisted development

## Goal

Make Webstir easier and faster to build with using coding agents, and establish repeatable evidence for that public product promise.

## Guardrails

- Scope this initiative to agents building and maintaining Webstir apps. Keep application-level AI features outside this roadmap.
- Preserve the server-first, HTML-first product lane, existing application behavior, and developer customizations. Support normal app work without changes to Webstir internals.
- Improve the existing CLI, inspection, scaffolding, repair, testing, and MCP surfaces. Add commands or abstractions only when observed failures justify them; do not build a new coding-agent host.
- Start with one coding-agent integration and the `full` app path. Expand supported-agent claims only after testing each named integration.
- Keep app guidance concise, version-aligned, and derived from a canonical source. Do not silently overwrite user-authored instructions or configuration.
- Edit canonical packages and Bun resources; update generated assets through their tooling. Preserve the existing required gate.
- Keep initial tasks, acceptance checks, budgets, and scoring fixed across comparisons. Use fresh agent contexts with consumer documentation and installed packages, without privileged access to the framework checkout or prior task history.
- Distinguish tool tests, observed agent outcomes, and speed comparisons. State the comparator and conditions for any performance claim; retain failures and human interventions in the results.
- The user invoked `$superflow` on this map: complete implementation, verification, review, and GitHub merge. Separate package publication remains outside scope; merging may trigger the repository's automatic docs deployment.

## Current evidence

- [Existing agent commands](../../orchestrators/bun/src/agent.ts) compose inspection, scaffolding, repair, and validation; the [MCP server](../../orchestrators/bun/src/mcp/server.ts) exposes a typed subset.
- [CLI tests](../../orchestrators/bun/tests/agent.integration.test.ts) and [MCP tests](../../orchestrators/bun/tests/mcp.integration.test.ts) exercise predetermined operations. Route scaffolding currently records metadata; a completed feature also needs application handlers and real behavior.
- The earlier [generated-app trial](../custom-runtime-hardening/AGENT_TRIAL.md) found and fixed real setup problems using locally linked packages. It provides useful prior evidence, but does not establish repeatable speed or completion rates through a fresh distributed installation.
- The [homepage](../../apps/portal/src/frontend/pages/home/index.html) already describes workspaces as legible to agents. This initiative develops the onboarding and evidence needed to make that a central promise. Public positioning is an explicit goal for this initiative, superseding the private-learning framing of the historical hardening plan.

## Execution Map

- [x] **1. Measure the current experience.**
  - Freeze three small tasks and their acceptance checks before making product changes:
    - Build: create a notes app from an empty directory with persistent create/edit/delete, form validation, and working HTML pages.
    - Extend: add a status field and filtering to an existing authenticated app while preserving authorization and normal form/navigation behavior.
    - Repair: fix a seeded application defect and scaffold drift while preserving unrelated customization.
  - Prepare isolated starting fixtures, evaluator-owned functional/browser checks, one holdout variation, and a run-record format under this initiative. Keep evaluation answers outside the agent's workspace.
  - Pin the package version, agent/model/settings, available tools, starting prompt, and time budget. Begin with three fresh runs per task; record correct completion, elapsed time, human interventions, retries, and usage/cost where available.
  - Use a fresh packaged installation outside the monorepo. Record the installation source and exact versions. Separate environment failures from product/task failures without silently dropping runs.
  - Rank the observed blockers and define improvement and claim criteria before changing the product. Evaluate correctness first and time to a correct result second; timeouts count as failures.
  - **Exit:** a reproducible baseline, working independent acceptance checks, and a short ranked list of observed friction. No speed claims yet.

- [x] **2. Make a new app understandable immediately.**
  - Generate concise app-level instructions covering file ownership, the normal feature workflow, available commands, and verification. Make the installed version's relevant recipes discoverable.
  - Provide one documented setup path for the initial coding-agent integration. Keep CLI access sufficient; document MCP as an optional way to reach the same operations.
  - Remove baseline setup blockers and missing dependencies. Verify guidance is included in the package, works outside the monorepo, and has an explicit preservation/update policy for existing apps.
  - **Exit:** a fresh agent can install, inspect, run, and check a new app using only the distributed product and its instructions, with no manual hints about framework internals.

- [x] **3. Make common features straightforward to complete.**
  - Use the baseline to choose at most two initial recipes, likely a persisted form/CRUD flow and an authenticated list/filter flow.
  - Each recipe must cover the complete application path: data changes, handler, validation/error behavior, HTML, and relevant tests. Show optional enhancement only after the baseline works.
  - Clarify what scaffold commands actually create, especially route metadata versus implemented handlers. Fix repeated missing wiring at its canonical source.
  - Reuse existing application and framework patterns. Add tooling only for repeated, mechanical work demonstrated by the trials.
  - **Exit:** agents can complete both selected feature paths without editing Webstir itself; independent checks prove rendered behavior, persistence, and relevant access boundaries.

- [x] **4. Make failures actionable and completion trustworthy.**
  - Address the highest-value remaining diagnosis and verification failures from the baseline: missing state, ambiguous output, incorrect success reporting, or unsupported repair expectations.
  - Keep errors attributable to a file/operation with a useful next action. Maintain nonzero failure exits and accurate structured results across CLI and MCP entry points.
  - Keep scaffold repair limited to changes it can verify. Make it clear when an application defect requires code changes.
  - Give the agent a documented path from framework checks to application-specific tests and browser verification; passing starter tests alone cannot establish task completion.
  - **Exit:** the repair task is diagnosable from available output, customizations survive, and deliberately broken acceptance cases cannot be reported as completed by the evaluation.

- [ ] **5. Demonstrate the outcome and prepare public positioning.**
  - Repeat the frozen tasks on the candidate package with the same agent settings, budgets, and scoring; run the holdout variation too. Use an installed candidate tarball outside the checkout until a public release is authorized.
  - Compare completion and intervention rates first, then elapsed time and cost with failure accounting. Report the full small sample and limitations. Revisit earlier steps if the predeclared criteria are not met.
  - Run relevant focused tests and the required repo gate for implementation changes. Verify generated guidance, assets, package installation, and browser behavior through consumer paths.
  - Produce one reproducible tutorial/demo that builds an app and then changes it, plus a concise [results report](RESULTS.md). Draft homepage/docs copy around demonstrated capabilities.
  - Use design-intent language such as "designed for building with AI coding agents" for capability positioning. Use "faster" only with a supported, stated comparison; do not infer superiority to other frameworks from a Webstir before/after comparison.
  - Prepare the release verification checklist. After a separately authorized release, repeat a fresh registry-install smoke before describing the new package behavior as publicly available.
  - **Exit:** reviewed implementation and consumer proof, a runnable walkthrough, an honest baseline/candidate comparison, and publication-ready copy with clear availability status.

## Done When

- New app guidance and the initial agent setup work from an installed package without framework-source knowledge.
- The build, extend, and repair tasks have repeated agent outcomes checked against independent functional/browser criteria, with a holdout result and failures retained.
- The selected feature recipes produce complete working behavior, and repair preserves unrelated application work.
- The baseline's improvement criteria are met or the claim/scope is explicitly narrowed to what the evidence supports. Quantified claims identify their comparator, versions, settings, sample size, and limitations.
- Required implementation checks, package-install proof, and the relevant browser checks pass.
- The tutorial, results report, and local marketing/docs changes are ready for a separately authorized release; plan completion does not itself mean npm publication or live deployment.

## Execution notes

- Delivery branch: `codex/agent-assisted-development`, starting from `d61456e9f60cb743bf894d839c6a6c66136db04e` on `main`.
- Registry baseline: `@webstir-io/webstir@0.1.65` verified available. Candidate will be installed from a local tarball outside the repository.
- Initial integration: Codex CLI `0.156.1`, `gpt-6-astra`, reasoning effort `high`, fresh ephemeral sessions and a workspace-write sandbox with network access for dependencies and local servers. Personal CLI config is excluded. The task-local CLI preflight passed; the older global CLI's incompatible-model failure is environment setup evidence, not a task trial.
- Evaluator implementation lives in `tools/agent-eval/`. Freeze task/fixture/grader hashes after positive and negative self-checks and before baseline runs. Agent logs and app artifacts stay in a task-owned temporary directory; commit a sanitized result summary and reproducible instructions.
- Predeclared candidate gate: no lower correct-completion count than baseline, at least two of three successful runs for each main task, a passing holdout, and no authorization/data-integrity regressions in accepted results. Any unsuccessful attempt remains in the report. Speed claims require an explicit comparison that accounts for failures; this sample supports only a bounded exploratory comparison.
- Protocol v1 frozen as `517060c1d57c919f96ddbe8e5fc1c326d268658256df85fa8f3b9af47d95c58e`. The known-good fixture passes all eight acceptance checks. Both seeded defects pass their existing app tests but fail independent CRUD and managed-file checks. Harness unit checks passed (5 tests, 33 assertions).
- Baseline campaigns completed under `/private/tmp/webstir-agent-eval/baseline-{build,extend,repair}` with three attempts each. The local Codex environment can discover generic user skills even with CLI config excluded; record this limitation in the report and audit traces for forbidden framework/evaluator access. Do not claim this is a hermetic agent environment.
- Execution overlap: after freezing and launching the registry baseline, implement the already-scoped onboarding and recipes while its remaining attempts run. Baseline installations use immutable published artifacts and the frozen evaluator, so these checkout edits cannot change their inputs. Final diagnosis priorities and candidate evaluation still depend on the complete baseline results.
- Scorer correction policy: v1's exact label locator rejected a valid native status filter because nested option text affected Playwright label matching. Finish all original baseline attempts unchanged, retain every v1 result, then apply the same role-based selector correction to every immutable baseline app in fresh grading copies before running the candidate. Record both evaluator fingerprints and source hashes before/after grading. This scorer-only correction does not rerun agents, change task inputs, omit failures, or reset their measured time. Any task, fixture, model, or budget change requires a new full comparison.
- Baseline v2 regrade: **9/9 passed**, all original/copy source/config hashes unchanged. Corrected protocol fingerprint: `7bb25790148af446ee374d0d7da503f95d6f13403b33f215250044f75e06d0e9`. The corrected oracle still rejects both seeded defects; evaluator regression tests passed (9 tests, 61 assertions). Runner fixes prevent evidence overwrites, bound readiness, and resolve both hoisted and bundled package layouts without changing task requirements.
- Onboarding/repair checks passed: 8 new guidance tests, 29 existing init/doctor/repair tests, TypeScript and asset synchronization. Independent review found no remaining preservation or filesystem-boundary issue.
- Recipe proof passed: 3 browser/consumer tests with 50 assertions, including lazy storage initialization, migration, CSRF/owner isolation, validation, and persistence. Review caught and resolved eager database writes during module inspection.
- Candidate tarball SHA-256: `e91c165ec469f6afcb5c91c011be77850c1ecb281d18bb01ce5392051498d022`. A fresh install outside the repository verified guidance and diagnostics, then built a copied notes recipe and passed 9 app tests using registry dependencies, with no monorepo links. Candidate campaigns are running with the corrected frozen protocol.
- Full `bun run check:required` passed: 23 tooling, 120 backend, 87 frontend, 14 testing-package, 193 core orchestrator, and 26 browser tests, plus contract checks, smoke/install checks, formatting/lint, asset checks, and portal build. Initial attempts exposed a corrected test inventory count and intermittent deployment-test startup failures; the exact failed fixture and narrow/full backend reruns pass. Test startup output is now retained; the original cause remains unproven. Existing lint warnings remain unchanged.
- Remaining delivery work: candidate sample and holdout, final results and claim review, final integrated review, and authorized PR merge.
- A separate `0.1.66` release landed on `main` as `b8aba02` during the trials. Preserve it when integrating this branch. The benchmark CLI artifacts stay fixed, but generated apps use compatible dependency ranges, and some later candidate apps resolved `0.1.66`. Record actual app versions per attempt and narrow the evidence to observed task capability, not a fully version-frozen speed comparison. The upstream backend/frontend/module-contract diff contains version/range metadata only; its production code change is the separate CLI static-site 404 fix. Retain all attempts without silently changing their inputs.
