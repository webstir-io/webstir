# Coding-agent app trials

This small harness measures one agent building consumer Webstir apps. It is a development experiment, not a cross-framework benchmark. Prompts, acceptance code, fixtures and the protocol fingerprint are frozen before a baseline. The evaluator is outside each agent's app workspace. No answers, grader code, previous run history or framework checkout are part of the task context.

## Frozen protocol v2

- Registry baseline: `@webstir-io/webstir@0.1.65`. Candidate: an installed, locally packed CLI tarball. Record each installed framework package version. Supply `--dependencies /absolute/overrides.json` only when candidate companion packages also changed; values must be packed tarball paths, never repository directory links.
- Agent: Codex CLI **0.156.1**, `gpt-6-astra`, reasoning effort `high`, fresh ephemeral context, user configuration ignored, built-in tools, no configured MCP servers. Normal `workspace-write` sandbox with network access for installs and local HTTP; no permission bypass. Pass the task-local executable using `--codex`.
- Three fresh runs per build/extend/repair task, **480 seconds** of agent execution each. Initial package/fixture installation and independent grading are excluded from agent elapsed time and retained separately. No hints or reruns within a trial. Manual intervention must be recorded in `result.json`; retries retain the original result and use a new campaign label.
- Build begins in an empty app directory; initializing the full app and installing its dependencies count against its budget. Extend and repair begin with installed dependencies and the same small authenticated CRUD application. Fixed local demonstration credentials belong only to this fixture.
- Every requirement is disclosed in the prompt, including stable route/form interfaces. Private acceptance verifies actual HTML CRUD with JavaScript disabled, server validation, restart persistence, and relevant ownership/CSRF boundaries. Repair also checks exact managed-file restoration and preserved customization. A JavaScript-enabled rendering check complements the baseline form flow.
- Holdout replaces the repair task's update defect with a deletion defect. Run it once on the candidate after the primary comparison. Do not use its outcome to tune recipes before the first holdout result.
- Correct completion requires every expected independent check and a successful agent process before the deadline. A success message, starter-test pass, or ungraded result never establishes completion. Timeouts count as failures. Setup/browser infrastructure errors and agent runtime errors remain separate outcomes and stay in the denominator. Task build/start/behavior errors count as task failures.
- Record raw JSONL, prompts, exact package versions, settings, timestamps, checks and screenshots outside git. Import only a reviewed sanitized summary into the plan. API usage appears in Codex JSONL when available; do not invent a dollar cost for subscription runs.

## Predeclared improvement gate

The candidate must match or improve the baseline's total correct completions, have at least **2/3 correct completions for each primary task**, pass the holdout, and introduce no observed authorization, CSRF, persistence or customization regression. If this floor fails, fix the product and repeat the complete candidate sample under a new label, retaining every earlier run. Baseline task failures may justify product improvements; environment errors do not establish product friction.

Compare completion and intervention rates first. Report all run outcomes before comparing elapsed time among correct results; timings from failed runs are not a speedup. A small sample may support capability positioning while remaining insufficient for a speed claim. Any advertised “faster” statement must name the Webstir before/after comparator, versions, same agent/settings, sample size and failed runs, and be supported by the observed comparison. This experiment cannot establish superiority over other frameworks.

## Commands

Run from the repository using Bun. All workspaces and results must be outside it. Browser grading uses the existing Playwright development dependency from `orchestrators/bun` and its installed Chromium.

```sh
bun tools/agent-eval/run.mjs --package 0.1.65 \
  --output /private/tmp/webstir-agent-eval --label baseline \
  --codex /absolute/path/to/codex --task all --repeats 3

bun tools/agent-eval/run.mjs --package /absolute/candidate.tgz \
  --output /private/tmp/webstir-agent-eval --label candidate \
  --codex /absolute/path/to/codex --task all --repeats 3

bun tools/agent-eval/run.mjs --package /absolute/candidate.tgz \
  --output /private/tmp/webstir-agent-eval --label candidate \
  --codex /absolute/path/to/codex --task holdout --repeats 1
```

`--task build|extend|repair` runs just one task. Independent task commands may use separate campaign labels to avoid concurrent installation writes. Never reuse an app directory. `--mode prepare` creates fixtures and a prompt without running an agent. `--mode grade --run-dir /absolute/run --agent-result /absolute/agent.json --repeats 1` grades a prepared run; that JSON must supply the real process `code`, `timedOut`, and `elapsedMs`, not the agent's self-report. `--mode self-check --task repair --repeats 1` skips agent execution and checks the pristine authenticated fixture. These oracle checks are not measured agent results.

Before freezing a measurement, a pristine repair fixture must pass; both seeded repair/holdout fixtures must fail CRUD and managed-file checks. Unit tests cover failure accounting and process timeouts. Scorer-only corrections may regrade every retained immutable agent artifact without rerunning the model. Retain the original prompt, fixture, settings, agent timing, logs and result; create fresh grading evidence/data, record both evaluator fingerprints, and verify the app source/config hash before and after grading. Apply the corrected evaluator uniformly to the entire baseline and candidate; never select only favorable runs. Changes to tasks, fixtures, model/settings, budgets or product inputs require fresh model runs.

## Protocol correction history

Version 1 fingerprint: `517060c1d57c919f96ddbe8e5fc1c326d268658256df85fa8f3b9af47d95c58e`.

Version 2 corrects only the Filter selector: Playwright `getByLabel('Filter', { exact: true })` incorrectly rejects a valid implicit label containing select options. The control's accessible name is Filter; `getByRole('combobox', { name: 'Filter', exact: true })` checks that public requirement correctly. The correction changes no task, fixture, agent settings, budget or app implementation. Version 2 also refuses reused trial directories and already-recorded grade results before writing campaign metadata, bounds readiness requests so a hung server becomes a task failure, resolves installed dependency versions from the CLI package for both hoisted and bundled layouts, and rejects regrade output aliases inside the original input tree or repository. These runner and artifact-safety corrections do not alter task acceptance requirements. All version 1 baseline attempts are retained and uniformly regraded before candidate trials. Original model completion times remain authoritative; regrading time is separate.

Use `bun tools/agent-eval/regrade.mjs --input /external/baseline-root --output /external/regraded-v2 --prefix baseline- --expected-runs 9` after all selected runs finish. The utility clones app source/config into a fresh grading workspace, links the existing dependency directory, retains original process metadata, verifies original and cloned artifact hashes, and writes separate results. A hash mismatch rejects the regrade. The input directory is never modified.
