# Process Runner — Phased Plan

## Phase 0: Library Introduction
- Implement shared runner with `RunAsync` and `StartAsync` modes.
- Register `IProcessRunner` in DI for Framework and Engine; enable fakes for Tester.
- Achieve parity for simple commands (spawn, await, capture output, timeouts).

## Phase 1: Low-Risk Adopters
- NodeRuntime: `node --version` via shared runner.
- Package manager runner: install dependencies with pnpm by default (`pnpm install --frozen-lockfile` → fallback to `npm install` when required).
- Framework Packaging: `npm view` / `npm publish`.

## Phase 2: Build and Test Tooling
- TestWorkflow: TypeScript compile (`tsc`) using `RunAsync` with per-line streaming.
- ModuleBuildExecutor and TestCliRunner: use `StartAsync`; keep event parsing at call sites.

## Phase 3: Long-Running Daemons
- NodeServer: startup, readiness detection, and shutdown via `StartAsync` (Ctrl+C when available).
- FrontendWatcher/Worker: watch mode with stdin writes and diagnostics.

## Phase 4: Tester Consolidation
- Replace `Tester/Infrastructure/ProcessRunner` with the shared runner, including wait-for-signal and termination policies.
- Provide a `FakeProcessRunner` for unit tests.

## Phase 5: Cleanup
- Remove remaining direct `ProcessStartInfo` / `Process.Start` usage across the repo.
- Remove duplicate kill/Ctrl+C helpers once all callers use the shared runner.
