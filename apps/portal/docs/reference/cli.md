# CLI

Active command reference for the Bun orchestrator. The default user-facing path is an installed `webstir` binary; the repo-local `bun run webstir -- <command>` form is for contributors working inside this monorepo. The CLI is optimized for server-first HTML apps with deliberate progressive enhancement, not for broad framework replacement.

> Historical note: the archived `.NET` orchestrator remains in-tree under `orchestrators/dotnet`, but it is no longer the active CLI for local development or framework evolution.

## Overview
- Package binary name: `webstir`
- Default packaged install path:
  - create a small tool root
  - `bun add @webstir-io/webstir`
  - invoke the installed binary from `node_modules/.bin/webstir`
- Primary entrypoint in this repo: `bun run webstir -- <command>`
- Works against a workspace root selected with `--workspace <path>` for all mutating or execution commands except `init` and `smoke`
- Supports the current workspace modes: `spa`, `ssg`, `api`, and `full`

## Usage

```bash
webstir <command> [options]
./node_modules/.bin/webstir <command> [options]
bun run webstir -- <command> [options]
```

Common patterns:
- external workspace: `./node_modules/.bin/webstir init full ./my-app`
- external workspace: `./node_modules/.bin/webstir watch --workspace "$PWD/my-app"`
- external workspace: `./node_modules/.bin/webstir publish --workspace "$PWD/my-app"`
- monorepo contributor path: `bun run webstir -- watch --workspace "$PWD/examples/demos/full"`
- monorepo contributor path: `bun run webstir -- add-route accounts --workspace "$PWD/examples/demos/api"`
- monorepo contributor path: `bun run webstir -- smoke`

## Commands

### init
Usage:
- `webstir init <mode> <directory>`
- `webstir init <directory>`

What it does:
- Scaffolds a new workspace for `full`, `ssg`, `spa`, or `api`
- Uses workspace dependencies when the target lives inside this monorepo; uses published package versions for external workspaces
- Creates the expected `src/frontend`, `src/backend`, `src/shared`, and `types` layout for the selected mode

Notes:
- Omitting `<mode>` falls back to the default scaffold path already supported by the Bun orchestrator
- Follow with `watch`, `build`, `test`, or `publish` against the new workspace

### refresh
Usage: `webstir refresh <mode> --workspace <path>`

What it does:
- Clears and re-scaffolds an existing workspace directory for the selected mode
- Restores the canonical workspace structure without routing through the archived CLI

Notes:
- This is destructive to generated workspace contents inside the target directory
- Demo refresh helper scripts in `examples/demos/utils/*.sh` use this Bun path now

### doctor
Usage: `webstir doctor --workspace <path>`

What it does:
- Checks scaffold drift by running the same workspace-aware analysis that powers `repair --dry-run`
- For `api` and `full`, also validates backend manifest health through the backend build path
- Reports backend data/migration health in JSON for backend-capable workspaces, including whether the runner and migrations directory are present, how many migration files exist, and which migration table is configured
- Accepts `--json` for machine-readable health output

Notes:
- Exits non-zero when it finds repairable scaffold drift or backend manifest/build failures
- Use this before `repair` when you want a diagnosis and suggested fix instead of immediately mutating the workspace

### repair
Usage: `webstir repair --workspace <path> [--dry-run]`

What it does:
- Restores missing scaffold-managed files for the current workspace mode
- Uses the current mode scaffold plus any explicitly enabled feature assets
- Re-applies wiring for recorded static feature flags like `search`, `clientNav`, `contentNav`, `backend`, and `githubPages`
- For package-managed enabled backends, restores the backend package scaffold instead of reintroducing stale mode-template backend files
- Accepts `--json` for machine-readable dry-run or repair output

Notes:
- `--dry-run` reports which files or scaffold-managed edits would be restored without writing anything
- This is the Bun-native recovery path when a workspace is missing expected scaffold files but you do not want the full reset behavior of `refresh`

### enable
Usage: `webstir enable <feature> [feature-args...] --workspace <path>`

What it does:
- Adds optional enhancements to an existing workspace
- Supported features include `scripts`, `spa`, `client-nav`, `search`, `content-nav`, `backend`, `github-pages`, and `gh-deploy`
- Updates workspace files and `package.json` flags so the feature is active on the next build/watch

Notes:
- Some features accept additional arguments before `--workspace`
- Demo feature-enablement flows now use the Bun orchestrator directly

### operations
Usage: `webstir operations`

What it does:
- Lists the stable Webstir framework operations that the Bun CLI exposes
- Marks which operations mutate a workspace, which support `--json`, and which are ready to wrap through MCP
- Accepts `--json` for a machine-readable operation catalog

Notes:
- This is the contract surface for wrappers and agents; it is intentionally narrower than the full implementation internals

### inspect
Usage: `webstir inspect --workspace <path>`

What it does:
- Runs `doctor` first and then surfaces the stable frontend and backend contract data that apply to the workspace mode
- Uses `frontend-inspect` for `spa`, `ssg`, and `full`
- Uses `backend-inspect` for `api` and `full`
- Accepts `--json` for machine-readable inspection output

Notes:
- Exits non-zero when diagnosis fails or when one of the applicable inspection surfaces fails
- This is the top-level inspection surface for wrappers and MCP adapters

### frontend-inspect
Usage: `webstir frontend-inspect --workspace <path>`

What it does:
- Reads stable frontend workspace facts without running a build
- Reports resolved frontend config, recorded enable flags, app-shell presence, discovered pages, and content-root basics
- Accepts `--json` for machine-readable inspection output
- Supports `spa`, `ssg`, and `full` workspaces only

### agent
Usage: `webstir agent <inspect|validate|repair|scaffold-page|scaffold-route|scaffold-job> --workspace <path> [goal-args...]`

What it does:
- Runs a thin orchestration layer on top of stable Webstir operations
- Supports inspection, validation, repair, and narrow scaffolding goals without inventing a new app architecture
- Accepts `--json` for machine-readable orchestration results

Notes:
- `inspect` remains the thin agent goal; use top-level `webstir inspect` when you want the direct combined inspection contract
- `validate` runs `doctor` and then `test`
- `repair` runs `doctor`, applies scaffold repair when available, and then re-checks health
- `scaffold-page`, `scaffold-route`, and `scaffold-job` call the matching scaffold commands and then verify the resulting workspace state

### build
Usage: `webstir build --workspace <path>`

What it does:
- Builds the selected workspace through the canonical provider packages
- Supports `spa`, `ssg`, `api`, and `full`
- Produces `build/frontend/**` and/or `build/backend/**` depending on workspace mode

### publish
Usage: `webstir publish --workspace <path> [--frontend-mode <bundle|ssg>]`

What it does:
- Produces publish artifacts in `dist/**`
- Reuses the same provider seams as `build`
- Handles the required frontend prebuild for `ssg` and `full` before publish output is finalized
- Accepts `--frontend-mode ssg` to force static-site publish behavior from the top-level Bun CLI

### watch
Usage: `webstir watch --workspace <path> [--host <host>] [--port <port>] [--verbose] [--hmr-verbose]`

What it does:
- Starts the Bun dev loop for the selected workspace
- Supports `spa`, `ssg`, `api`, and `full`
- Runs the Bun static/dev server for frontend flows
- Supervises the backend runtime for `api` and `full`
- Proxies `/api/*` in `full` mode

Notes:
- Frontend runtime selection is no longer a CLI option
- SPA and SSG watch serve frontend output and trigger reloads after rebuilds
- API watch rebuilds and restarts the backend runtime after successful backend changes
- Full watch uses a Bun-native frontend host plus backend `/api` proxy composition

### test
Usage: `webstir test --workspace <path> [--runtime <frontend|backend|all>]`

What it does:
- Builds the relevant workspace targets before test execution
- Discovers tests under `src/**/tests/`
- Runs compiled tests through the canonical testing providers
- Supports runtime filtering with `--runtime` or `WEBSTIR_TEST_RUNTIME`

Notes:
- `frontend` only: runs frontend suites for `spa`, `ssg`, and `full`
- `backend` only: runs backend suites for `api` and `full`
- `all` is the default and runs whatever the workspace mode supports

### smoke
Usage: `webstir smoke [--workspace <path>]`

What it does:
- Runs a bounded end-to-end Bun verification flow:
- `build`
- `test`
- `publish`
  - `doctor`
  - `backend-inspect` for backend-capable workspaces
- If `--workspace` is omitted, scaffolds a temporary server-first full workspace from Bun-owned templates
- Prints a compact phase-by-phase summary

Notes:
- The default temporary workspace avoids mutating tracked demo workspaces while still exercising the full Bun-owned smoke surface, while leaving `client-nav` as an opt-in enhancement
- For external copied workspaces, backend type-checking is skipped only when necessary to avoid monorepo-only TypeScript resolution assumptions

### backend-inspect
Usage: `webstir backend-inspect --workspace <path>`

What it does:
- Builds the backend and reads the resulting manifest data
- Prints module metadata, capabilities, routes, views, jobs, and data/migration facts
- Accepts `--json` for machine-readable manifest output
- Supports `api` and `full` workspaces only

### mcp
Usage: `webstir mcp`

What it does:
- Runs the Webstir MCP server over stdio
- Exposes the thin stable tool layer for listing operations plus inspect, validate, repair, and scaffold flows
- Reuses the existing machine-readable CLI contracts instead of introducing a second control plane

### add-page
Usage: `webstir add-page <name> --workspace <path>`

What it does:
- Scaffolds a frontend page in the selected workspace
- Uses the canonical frontend tooling path rather than a Bun-only fork
- Handles SSG page generation without forcing page scripts when the workspace mode is `ssg`

### add-test
Usage: `webstir add-test <name-or-path> --workspace <path>`

What it does:
- Creates a `.test.ts` file under the nearest matching `tests/` folder
- Works for both frontend and backend test locations
- Reuses the canonical testing package scaffold helper

### add-route
Usage: `webstir add-route <name> --workspace <path> [--method <METHOD>] [--path <path>] [--interaction <navigation|mutation>] [--session <optional|required>] [--session-write] [--form-urlencoded] [--csrf] [--fragment-target <target>] [--fragment-selector <selector>] [--fragment-mode <replace|append|prepend>] [...schema/metadata flags]`

What it does:
- Adds a backend route entry to `webstir.moduleManifest.routes` in `package.json`
- Supports route metadata and schema reference flags already documented by the module contract
- Exposes first-class route intent for navigation vs mutation, session requirements, form encoding, CSRF, and fragment-target responses
- Exposes the common HTML-first route primitives directly:
  - `--interaction navigation|mutation`
  - `--session optional|required`
  - `--session-write`
  - `--form-urlencoded`
  - `--csrf`
  - `--fragment-target <name>` with optional `--fragment-selector` and `--fragment-mode`

### add-job
Usage: `webstir add-job <name> --workspace <path> [--schedule <expression>] [--description <text>] [--priority <value>]`

What it does:
- Creates `src/backend/jobs/<name>/index.ts`
- Adds a backend job entry to `webstir.moduleManifest.jobs`
- Preserves schedule, description, and priority metadata in the manifest
- Validates cron fields, `@macro` schedules, and `rate(...)` schedules before writing files
- The generated scheduler supports one-off runs, `--list`, `--json`, cron/nickname schedules, `rate(...)`, and `@reboot`; local watch mode skips overlapping runs and disposes timers on `SIGINT`/`SIGTERM`

## Dependency Management
- There is no Bun `webstir install` command.
- Manage workspace dependencies with `bun install`.
- Provider-specific packages are normal workspace dependencies, not a separate framework-managed install flow.

## Related Docs
- Solution — [solution](../explanations/solution.md)
- Test workflow — [test](../how-to/test.md)
- Add test — [add-test](../how-to/add-test.md)
- Demos — [examples/demos/README.md](https://github.com/webstir-io/webstir/blob/main/examples/demos/README.md)
