# Backend Testing Tooling Plan

## Goal
- Give backend module authors a first-class way to run route + contract tests from the CLI, including request helpers that understand the module manifest emitted by `@webstir-io/webstir-backend`.
- Provide a standardized harness that can spin up the compiled backend server (default scaffold or Fastify) for integration tests and dev loops without manual scripts.
- Fit into the existing `webstir test` / `webstir watch` workflows so backend coverage runs automatically in CI and during `webstir watch`.

## Current State
- `webstir test` compiles TypeScript, builds the backend via `ModuleBuildExecutor`, then shells out to `webstir-testing` (`orchestrators/dotnet/Engine/Workflows/TestWorkflow.cs:21-60`). The runner simply executes compiled `.test.js` files inside a Node VM (`packages/tooling/webstir-testing/src/runtime.ts`), so backend tests cannot hit a real server or share bootstrapped context.
- The manifest metadata and route definitions exposed by `backendProvider` (`packages/tooling/webstir-backend/src/provider.ts`) are only logged in dev/watch (`orchestrators/dotnet/Engine/Services/DevService.cs:24-121`). There is no automated harness to assert that handlers satisfy their contract or that exported routes respond correctly.
- Developers that need integration coverage must manually start `node build/backend/index.js` (or Fastify) in one terminal and run ad-hoc scripts in another, which does not exercise orchestrator plumbing, env toggles, or module events.

## In Scope
- Extend the CLI surface so backend-only tests can be invoked directly (headless) or alongside `webstir watch`.
- Introduce a backend-aware testing provider that can start the compiled server, expose HTTP helpers, and hydrate route metadata/contracts for assertions.
- Wire readiness + teardown into `ProcessHandle` so test workflows can block on a healthy `/api/health` without bespoke scripts.
- Document the harness (APIs, env vars, defaults) inside `webstir-portal` and surface the workflow under the “Backend Design” plan.

## Out of Scope
- Shipping new backend server scaffolds (Fastify already exists under `templates/backend/server/fastify.ts`).
- Replacing the existing `webstir-testing` manifest discovery logic.
- Full E2E orchestration across frontend + backend + database (follow-up once backend harness lands).

## Functional Requirements
1. **CLI entry points**
   - `webstir backend test [--watch] [--filter <glob>] [--dev-server <embedded|external>]` routes to a dedicated workflow so backend modules do not need to scan frontend specs.
  - `webstir backend dev [--tests] [--port <number>]` starts the backend watch pipeline (`startBackendWatch` from `packages/tooling/webstir-backend/src/watch.ts`) and optionally triggers backend tests on rebuild.
   - Existing `webstir test` / `webstir watch` commands should delegate to the backend harness when backend tests are present so CI does not need a new entry point.
2. **Harness behavior**
   - Each backend test run must build the backend in `ModuleBuildMode.Test` and capture manifest routes before starting tests.
   - The harness should start the compiled backend entry (`build/backend/index.js` or Fastify) once, wait for the readiness log (`API server running`), expose the port + base URL to tests, then reuse the process across files unless a test requests isolation.
   - Provide a TypeScript helper (e.g., `import { backendTest } from '@webstir-io/webstir-backend/testing'`) that wraps the generic `test()` API, injects a supertest-like `request()` helper, and preloads module routes + schema metadata.
3. **Contract assertions**
   - Helpers should be able to load the hydrated module manifest (routes, schemas) returned from the provider to ensure tests can compare responses against the declared contract (status codes, schema refs).
   - Failures should emit `WEBSTIR_MODULE_EVENT` lines so orchestrator logs mirror the existing test runner output.
4. **Dev server for integration**
   - `webstir backend dev --tests` should combine the esbuild watch (`startBackendWatch`) with the new harness: rebuild on change, restart the backend server, rerun backend specs, surface hot output via the Dev Service console.

## Non-Functional Requirements
- Runs must work in air-gapped CI (no npm install during test time). All helpers must live in first-party packages (`@webstir-io/webstir-backend`, `@webstir-io/webstir-testing`).
- Server startup/teardown must respect the shared `ProcessHandle` timeout + cancellation semantics (`orchestrators/dotnet/Utilities/ProcessRunner/ProcessHandle.cs`), so hung tests do not wedge the CLI.
- The harness cannot assume a specific framework. It should treat the compiled backend entry as a black box that emits readiness logs and honors `PORT`/`NODE_ENV`/`API_BASE_URL`.
- Watch mode should debounce restarts (≥250 ms) to avoid thrashing when esbuild emits multiple files.

## Proposed Architecture
### 1. CLI & Workflow updates (C#)
- Add `BackendTestWorkflow` and `BackendDevWorkflow` inside `orchestrators/dotnet/Engine/Workflows/`.
  - `BackendTestWorkflow` shares the existing `TestWorkflow` steps (build, tsc, provider build) but injects a new `BackendTestHarness` right after `CompileBackendAsync()`.
  - `BackendDevWorkflow` wraps `startBackendWatch` (spawned via `node dist/watch.js`) using `ProcessRunner`. It listens for the readiness log before marking the Dev Service “ready” and can optionally trigger backend tests after each successful build.
- Extend `orchestrators/dotnet/CLI/Help.cs` + DI wiring so `webstir backend test`/`dev` are discoverable. The legacy `webstir test` command will internally invoke `BackendTestWorkflow` when backend tests exist to keep defaults working.

### 2. Node-side harness (`@webstir-io/webstir-backend/testing`)
- New export: `createBackendTestHarness()` that starts the compiled backend entry (defaults to `build/backend/index.js`, with Fastify fallback) and returns:
  ```ts
  type BackendTestContext = {
    request: (init?: RequestInit & { path?: string }) => Promise<Response>;
    manifest: ModuleManifest | null;
    routes: readonly RouteSpec[];
    url: URL;
    env: Record<string, string>;
  };
  ```
- Provide `backendTest(name, handler, options?)` helper that mirrors `test()` but injects the shared context. Under the hood it calls the existing `test()` API provided by `@webstir-io/webstir-testing`.
- Respect env contracts:
  - `WEBSTIR_BACKEND_TEST_PORT` (default 4100; auto-increment if busy).
  - `WEBSTIR_BACKEND_TEST_ENTRY` to override the server entry (Fastify vs default).
  - `WEBSTIR_BACKEND_TEST_ONCE` to restart per test file when isolation is required.

### 3. Testing provider integration (`@webstir-io/webstir-testing`)
- Introduce a backend-aware provider that satisfies the current `TestProvider` interface (`packages/tooling/webstir-testing/src/providers.ts`). It wraps the VM runtime but augments the global with `backendTest`.
- Provider responsibilities:
  - Before executing a file, launch the backend harness (if not already running) and share the context via a global symbol.
  - After the file completes, stop or recycle the server based on `WEBSTIR_BACKEND_TEST_ONCE`.
  - Emit module-level log events so the C# runner can show backend-specific failures distinctly.
- Backend tests live under `src/backend/tests/**/*.test.ts` (current default), so no manifest changes are required.

### 4. Dev server plumbing
- `ProcessHandle` already exposes `WaitForReadyAsync()` with a readiness token. Update `NodeServer` (used by `DevService`) to watch for the backend readiness message so `webstir backend dev` can block until the server is usable.
- Watch mode flow:
  1. Spawn `node dist/watch.js` from `@webstir-io/webstir-backend` (honoring `WEBSTIR_BACKEND_TYPECHECK` toggles).
  2. On rebuild success, restart the runtime server (`node build/backend/index.js`) and run backend tests (if `--tests` was passed).
  3. Stream diagnostics to the console the same way `startBackendWatch` currently prints esbuild messages.

## Validation Strategy
- **Unit**: Add focused tests for `BackendTestHarness` (mock server, verify retries) and CLI argument parsing.
- **Integration**: Extend `Tester/Workflows/Test/TestWorkflowTests.cs` with scenarios that include backend tests hitting a fake route (compile sample project, assert HTTP 200 using the harness).
- **Manual**: Run `webstir backend dev --tests` inside the sample workspace to verify hot rebuilds restart the server and re-run tests without hanging.

## Rollout / Steps
1. Ship the design doc (this file) and link it from `PLAN.md` / `TODO.md`.
2. Implement Node harness + testing provider updates (`@webstir-io/webstir-backend` + `@webstir-io/webstir-testing`).
3. Add new CLI workflows + help text in `orchestrators/dotnet`.
4. Update docs (`apps/portal/docs/how-to/test.md`, CLI reference) with usage examples.
5. Enable backend tests inside `webstir watch` once stability is proven.

## Open Questions
- Should the harness auto-provision database/auth adapters, or do we rely on user-provided test doubles initially?
- Do we need per-test isolation (restart server + reset module state) or is file-level isolation sufficient?
- How should we surface contract schema mismatches? (Option A: fail tests immediately; Option B: emit warnings and let assertions decide.)
- Where should we persist integration test fixtures (inline in tests vs `tests/fixtures/*` with helper loaders)?
