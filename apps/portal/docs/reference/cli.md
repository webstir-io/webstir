# CLI

Active command reference for the Bun orchestrator. In this monorepo, the supported orchestration path is `webstir`, usually invoked from the repo root as `bun run webstir -- <command>`.

> Historical note: the archived `.NET` orchestrator remains in-tree under `orchestrators/dotnet`, but it is no longer the active CLI for local development or framework evolution.

## Overview
- Primary entrypoint in this repo: `bun run webstir -- <command>`
- Package binary name: `webstir`
- Works against a workspace root selected with `--workspace <path>` for all mutating or execution commands except `init` and `smoke`
- Supports the current workspace modes: `spa`, `ssg`, `api`, and `full`

## Usage

```bash
webstir <command> [options]
bun run webstir -- <command> [options]
```

Common patterns:
- `bun run webstir -- init ssg ./docs`
- `bun run webstir -- repair --workspace "$PWD/examples/demos/spa"`
- `bun run webstir -- watch --workspace "$PWD/examples/demos/full"`
- `bun run webstir -- test --workspace "$PWD/examples/demos/spa"`
- `bun run webstir -- publish --workspace "$PWD/examples/demos/ssg/site"`
- `bun run webstir -- add-route accounts --workspace "$PWD/examples/demos/api"`
- `bun run webstir -- smoke`

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

### repair
Usage: `webstir repair --workspace <path> [--dry-run]`

What it does:
- Restores missing scaffold-managed files for the current workspace mode
- Uses the canonical scaffold assets already baked into the Bun orchestrator
- Re-applies wiring for recorded static feature flags like `search`, `clientNav`, `contentNav`, and `githubPages`

Notes:
- `--dry-run` reports which files or scaffold-managed edits would be restored without writing anything
- This is the Bun-native recovery path when a workspace is missing expected scaffold files but you do not want the full reset behavior of `refresh`

### enable
Usage: `webstir enable <feature> [feature-args...] --workspace <path>`

What it does:
- Adds optional scaffolded features to an existing workspace
- Supported features include `scripts`, `spa`, `client-nav`, `search`, `content-nav`, `backend`, `github-pages`, and `gh-deploy`
- Updates workspace files and `package.json` flags so the feature is active on the next build/watch

Notes:
- Some features accept additional arguments before `--workspace`
- Demo feature-enablement flows now use the Bun orchestrator directly

### build
Usage: `webstir build --workspace <path>`

What it does:
- Builds the selected workspace through the canonical provider packages
- Supports `spa`, `ssg`, `api`, and `full`
- Produces `build/frontend/**` and/or `build/backend/**` depending on workspace mode

### publish
Usage: `webstir publish --workspace <path>`

What it does:
- Produces publish artifacts in `dist/**`
- Reuses the same provider seams as `build`
- Handles the required frontend prebuild for `ssg` and `full` before publish output is finalized

### watch
Usage: `webstir watch --workspace <path> [--host <host>] [--port <port>] [--verbose] [--hmr-verbose]`

What it does:
- Starts the Bun dev loop for the selected workspace
- Supports `spa`, `ssg`, `api`, and `full`
- Runs the Bun static/dev server for frontend flows
- Supervises the backend runtime for `api` and `full`
- Proxies `/api/*` in `full` mode

Notes:
- SPA and SSG watch serve frontend output and trigger reloads after rebuilds
- API watch rebuilds and restarts the backend runtime after successful backend changes
- Full watch composes both paths into one Bun-first full-stack loop

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
  - `backend-inspect` for backend-capable workspaces
- If `--workspace` is omitted, uses a temporary copy of `examples/demos/full`
- Prints a compact phase-by-phase summary

Notes:
- The default temp-copy behavior avoids mutating tracked demo workspaces
- For external copied workspaces, backend type-checking is skipped only when necessary to avoid monorepo-only TypeScript resolution assumptions

### backend-inspect
Usage: `webstir backend-inspect --workspace <path>`

What it does:
- Builds the backend and reads the resulting manifest data
- Prints module metadata, capabilities, routes, and jobs
- Supports `api` and `full` workspaces only

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
Usage: `webstir add-route <name> --workspace <path> [--method <METHOD>] [--path <path>] [--fastify] [...schema/metadata flags]`

What it does:
- Adds a backend route entry to `webstir.moduleManifest.routes` in `package.json`
- Can also scaffold and register a Fastify handler with `--fastify`
- Supports route metadata and schema reference flags already documented by the module contract

### add-job
Usage: `webstir add-job <name> --workspace <path> [--schedule <expression>] [--description <text>] [--priority <value>]`

What it does:
- Creates `src/backend/jobs/<name>/index.ts`
- Adds a backend job entry to `webstir.moduleManifest.jobs`
- Preserves schedule, description, and priority metadata in the manifest

## Dependency Management
- There is no Bun `webstir install` command.
- Manage workspace dependencies with `bun install`.
- Provider-specific packages are normal workspace dependencies, not a separate framework-managed install flow.

## Related Docs
- Solution — [solution](../explanations/solution.md)
- Test workflow — [test](../how-to/test.md)
- Add test — [add-test](../how-to/add-test.md)
- Demos — [examples/demos/README.md](https://github.com/webstir-io/webstir/blob/main/examples/demos/README.md)
