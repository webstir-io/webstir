# Failure-Mode Test Matrix

Backlink: [EXECMAP.md](./EXECMAP.md)

This matrix is the starting queue for agent-driven hardening. Add implementation tests before changing subsystem behavior, then refine the row as the behavior becomes explicit.

## Priority Order

1. Data and migrations: least proven and stateful.
2. Jobs: least proven scheduler behavior.
3. Auth: already covered on key happy paths, but security-sensitive negative cases need fixtures.
4. Sessions and forms: meaningful coverage exists, but state corruption and replay cases need sharper tests.
5. Frontend runtime and client navigation: browser edge cases and fallback behavior.
6. Inspect, doctor, repair, agent, and MCP: machine-readable truth and unhealthy-state preservation.
7. Contracts and testing package: schema/event drift and invalid fixtures.
8. Frontend build pipeline and backend runtime helpers: parity, artifact drift, and negative runtime cases.

## Data And Migrations

- Apply migrations in sorted order and report status/list output.
- Re-running applied migrations is idempotent.
- `--steps` applies or rolls back only the requested count.
- Duplicate migration ids fail clearly.
- Malformed migration modules are skipped or rejected according to documented policy.
- Failed `up()` leaves a clear state and does not record success.
- Migration table names are validated before SQL interpolation.
- SQLite paths resolve from workspace root even when invoked from another cwd.
- Placeholder conversion preserves quoted strings and comments for Postgres-compatible SQL.

## Jobs

- `--list` and `--json` expose stable job metadata.
- `--job` succeeds for existing jobs and fails clearly for missing jobs.
- Missing job modules and modules without `run()` fail clearly.
- Throwing jobs set failure exit state and preserve useful diagnostics.
- `@reboot`, `rate(...)`, and supported cron expressions schedule as documented.
- Unsupported schedules produce explicit diagnostics.
- Overlap policy for long-running jobs is defined and tested.
- Watch mode cleans up timers on shutdown.

## Auth

- Valid HS256, RS256 public-key, and JWKS tokens authenticate.
- Expired, not-yet-valid, wrong issuer, and wrong audience tokens fail closed.
- Unsupported algorithms fail closed.
- Malformed base64, malformed JSON, missing signatures, and wrong keys fail closed.
- Unknown `kid` triggers refresh behavior without accepting bad tokens.
- JWKS fetch timeout/error behavior is explicit.
- Invalid numeric-date claims fail closed.
- Service-token precedence is explicit when an invalid bearer token is also present.
- Diagnostics never log secrets or full token values.

## Sessions And Forms

- Expired session records and stale cookies clear predictably.
- Tampered signed cookies fail closed.
- Malformed SQLite rows either fail clearly or are ignored according to documented policy.
- Flash messages publish, consume once, and do not leak into persisted app payloads.
- CSRF mismatch and replay fail and preserve form retry state.
- Validation failures redirect with field/form issues intact.
- Auth-required form failures preserve the intended redirect behavior.
- Production defaults require secure session configuration.
- Session id rotation expectations are documented and tested.

## Frontend Runtime And Client Navigation

- Boundary cleanup runs in reverse order even when one cleanup throws.
- Failed mount does not leave duplicate handlers or stale child boundaries.
- Child boundaries unmount before parents.
- Hot state restores only when the boundary provides restoration behavior.
- Same-origin links update URL/history/title/main content.
- External links, downloads, new tabs, and same-document anchors fall back to browser behavior.
- Failed fetch, non-HTML response, 4xx/5xx response, and invalid fragment response fall back to document navigation.
- Fragment replace, append, and prepend behavior is tested.
- Focus, autofocus, scroll, head/style/script sync, and concurrent request aborts are covered in browser tests.

## Inspect, Doctor, Repair, Agent, And MCP

- Healthy and unhealthy inspect outputs keep stable JSON shapes.
- Doctor reports scaffold drift with actionable issue codes.
- Repair dry-run and apply agree on planned changes.
- Missing scaffold files are repairable; corrupted scaffold files are detected or explicitly out of scope.
- Agent validate does not skip meaningful checks after diagnosis failures unless the output says so.
- MCP tools preserve structured content for healthy and unhealthy results.
- MCP wrappers do not invent behavior separate from CLI JSON outputs.

## Contracts And Testing Package

- Generated schemas stay in sync with source contracts.
- Invalid route/session/form/fragment/job fixtures are rejected.
- Examples and providers compile against public contract types.
- Testing events have stable JSON shapes.
- Missing compiled test output and invalid runtime filters fail clearly.
- Mixed frontend/backend test discovery maps source files to build output correctly.

## Frontend Build Pipeline And Backend Runtime

- SPA, SSG, API, and full fixture builds produce exact expected artifact graphs.
- Bun and esbuild output parity is asserted where both are supported.
- Hashed asset cleanup removes stale outputs.
- Incremental changed-file behavior rebuilds dependent artifacts.
- Malformed app templates and page fragments fail clearly.
- Backend module load failures produce unhealthy readiness state.
- Route matching, hook ordering, hook errors, body parsing, fragment validation, metrics, and response headers have negative-path coverage.
