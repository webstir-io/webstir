# Test

Build the workspace and execute tests through the active Bun orchestrator. By default the run uses the VM-based `@webstir-io/webstir-testing` provider, but the Bun test flow still composes the canonical testing package rather than re-implementing test execution.

## Purpose
- Validate behavior via end-to-end and smoke tests.
- Keep the public contracts locked down.

## When To Use
- After changes to pipelines or templates.
- In CI to gate merges and releases.

## CLI
- `webstir test --workspace <path> [--runtime <frontend|backend|all>]`
- In this repo: `bun run webstir -- test --workspace "$PWD/<workspace>"`

## Steps
1. Build the relevant frontend and/or backend targets for the workspace mode.
2. Discover tests under `src/**/tests/`.
3. Compile those tests into `build/**`.
4. Execute the compiled suites through the canonical testing providers and print a pass/fail summary.

### Scope the run
- Use `--runtime frontend`, `--runtime backend`, or `--runtime all` (default) to limit which suites compile and execute.
- The CLI logs the resolved workspace mode plus your filter so you can confirm what actually ran.
- Environment toggle: `WEBSTIR_TEST_RUNTIME=<scope>` mirrors the flag and is convenient for scripts/CI.

## Provider Selection

### Defaults
- `@webstir-io/webstir-testing` (pinned VM runtime) runs compiled tests inside the sandbox that ships with the CLI.
- Provider overrides apply to the entire manifest run; mixed providers per-module are not supported.

### Quickstart: Alternate Provider
1. Install the provider in the workspace with your package manager.
2. Ensure `vitest` is available (the provider resolves the workspace dependency).
3. Run the suite:\
   `WEBSTIR_TESTING_PROVIDER=@webstir-io/vitest-testing bun run webstir -- test --workspace "$PWD"`
4. Any provider-specific installation remains a normal workspace dependency concern; use `bun install` when the workspace dependency graph changes.

> Tip: Keep `WEBSTIR_TESTING_PROVIDER_SPEC` empty (default) when consuming the published provider from the registry.

## Known Limitations
- Snapshot assertions are not yet supported in the default VM provider; track behavior through standard assertions or adopt an alternate provider that supplies its own snapshot tooling.
- Tests execute serially today. Parallel execution toggles are planned but not yet exposed—expect sequential runs until the runtime grows explicit parallel orchestration.

## Outputs
- Exit code 0 on success; non-zero on failures.
- Logs with clear failure messages.

## Errors & Exit Codes
- Non-zero on test failures, build failures, or configuration errors.

## Related Docs
- Workflows — [workflows](../reference/workflows.md)
- CLI — [cli](../reference/cli.md)
- Tests — [tests](../explanations/testing.md)
- Engine — [engine](../explanations/engine.md)
- Pipelines — [pipelines](../explanations/pipelines.md)
