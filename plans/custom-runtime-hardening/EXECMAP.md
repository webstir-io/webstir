# Custom Runtime Soundness Execmap

## Goal

Use coding agents to make Webstir's custom runtime pieces technically sound by turning each subsystem into explicit behavior, failure-mode tests, and agent-readable diagnostics.

## Guardrails

- Treat Webstir as a personal learning and agent-capability project, not a public framework race.
- Keep custom implementations by default; replace code only when tests or review show a specific risk that is not worth owning.
- Use mature libraries and standards as references, fixtures, and comparison targets, not as automatic replacements.
- Define soundness as observable behavior: contracts, tests, diagnostics, repair paths, and repeatable gates.
- Do not accept architecture claims without repo evidence and verification.
- Keep Webstir-owned code focused on app shape, scaffolding, contracts, inspection, repair, and agent operations.
- Do not expand Webstir toward a general-purpose frontend framework, ORM, auth platform, queue, or deploy ecosystem.
- Keep release/publish scripts manual unless explicitly requested.

## Execution Map

- [x] Define technical soundness criteria for each custom subsystem.
  - Create a compact criteria doc for contracts, orchestration, frontend build/runtime, client navigation, backend forms, sessions, auth, data/migrations, jobs, testing, inspect, doctor, repair, agent, and MCP.
  - For each subsystem, state supported behavior, unsupported behavior, failure modes, and the minimum proof required before calling it sound.
  - Make the default decision "custom and hardened" unless a concrete risk says otherwise.

- [x] Build the failure-mode test matrix.
  - Add or plan focused tests before changing implementation behavior.
  - Cover negative paths, corrupt state, stale generated files, malformed inputs, unsupported modes, and browser/runtime fallback behavior.
  - Keep tests scoped to the subsystem under hardening so agent changes remain reviewable.

- [x] Harden custom data and migration behavior.
  - Keep the migration runner custom while making its limits explicit.
  - Add status output, table-name validation, transaction policy, rollback policy, seed/test-reset convention, and failure-mode coverage.
  - Use Drizzle only as an optional comparison or future integration point if it helps evaluate the custom workflow.
  - Teach `inspect` and `doctor` to expose data workflow health where practical.
  - Progress: status output, table-name validation, duplicate-id rejection, transaction/rollback policy, test-reset convention, focused migration runner failure tests, and backend inspect/doctor migration diagnostics are implemented locally.

- [x] Harden custom auth behavior.
  - Keep the generated auth adapter custom for the learning slice.
  - Compare HS256, RS256, JWKS, issuer, audience, expiry, not-before, and service-token behavior against known-good fixtures or `jose` reference checks.
  - Fail closed for unsupported algorithms, malformed tokens, bad keys, bad claims, and fetch/cache errors.
  - Document exactly which auth cases Webstir owns and where a real app should delegate to an external identity provider.
  - Progress: the adapter now rejects malformed compact segments and invalid `iat`, while focused tests cover unsupported algorithms, wrong issuer/audience, bad numeric dates, malformed JSON/base64, missing signatures, wrong keys, JWKS refresh/fetch failure/timeout, service-token precedence, and redacted diagnostics.

- [x] Harden sessions and forms as a single stateful workflow.
  - Define the supported model for signed cookie ids, store-backed session payloads, flash, CSRF, form retry state, and production defaults.
  - Add tests for expired sessions, stale cookies, malformed persisted rows, CSRF mismatch, validation redirect, flash consumption, and session rotation behavior.
  - Keep SQLite session persistence custom unless the hardening pass finds a concrete reason not to.
  - Progress: stale/tampered cookies clear, expired records are deleted, malformed SQLite rows fail clearly, CSRF tokens are single-use, retry state is preserved, and ordinary update vs clear/recreate session id behavior is documented and tested.

- [x] Harden jobs as a local/simple scheduler.
  - Define overlap policy, shutdown behavior, error reporting, JSON status, cron/rate support, and unsupported production-queue boundaries.
  - Add tests for schedule parsing, one-shot jobs, repeated jobs, failures, and graceful shutdown.
  - Keep durable queue semantics out of scope for this slice.
  - Progress: local watch mode skips overlapping runs, disposes timers on shutdown signals, reports unsupported schedules, and has focused scheduler tests for metadata, missing jobs/modules, thrown jobs, supported schedules, and overlap.

- [x] Harden frontend runtime and navigation boundaries.
  - Define supported client navigation, boundary lifecycle, script execution, scroll/focus, head sync, fragment form updates, and fallback behavior.
  - Add browser tests for supported edge cases and explicit document-navigation fallback cases.
  - Keep the runtime intentionally smaller than a full SPA router.
  - Progress: cleanup/hot-state/failed-mount runtime cases are covered, document navigation now renders only successful HTML/XHTML responses, Bun-owned templates and demos are synced, and browser tests prove same-origin swaps plus non-intercepted/fallback navigation boundaries in watch and publish modes.

- [x] Make subsystem truth agent-readable.
  - Extend `inspect`, `doctor`, `repair`, or `agent validate` where a subsystem currently requires humans or agents to infer state from files.
  - Prefer stable JSON fields and actionable issue codes over prose-only diagnostics.
  - Ensure repair paths are mechanical only where the repo can verify the result.
  - Progress: backend inspect/doctor expose data migration facts, generated backend manifests now merge package-authored routes and jobs with compiled module definitions, and repair understands package-managed enabled backends.

- [x] Run an agent capability trial on a generated app.
  - Create or reuse one generated app that exercises data, auth, forms, sessions, a job, and frontend navigation.
  - Ask an agent to inspect it, add a small feature, repair an introduced drift, validate it, and explain the result using Webstir commands.
  - Record where the agent needed framework-internal knowledge or touched Webstir internals for normal app work.
  - Progress: recorded in [AGENT_TRIAL.md](./AGENT_TRIAL.md). Final local-link trial passed inspect, scaffold-job, scaffold-route, repair, and validate using current checkout packages.

- [x] Final review and repo-truth cleanup.
  - Run the required gate and focused subsystem checks.
  - Review whether each subsystem meets its soundness criteria or has documented remaining limits.
  - Update `plans/plan.md` so it truthfully reflects whether this hardening slice is still active.
  - Progress: focused subsystem checks, `bun audit --audit-level=high`, `git diff --check`, and `bun run check:required` pass locally. `plans/plan.md` now reflects no active next step for this slice.

## Done When

- Each custom subsystem has explicit soundness criteria and focused failure-mode coverage.
- Custom implementations remain custom by default, with any replacement decision tied to concrete evidence.
- Data, auth, sessions/forms, jobs, and frontend navigation have documented supported behavior and limits.
- `inspect`, `doctor`, `repair`, or `agent validate` expose enough subsystem truth for agents to work without guessing.
- One generated-app trial demonstrates whether an agent can safely make app-level changes without modifying Webstir internals.
- The repo's required gate passes, and `plans/plan.md` accurately reflects the active or completed state.
