# CLI

Active command reference for the Bun orchestrator. The default user-facing path is an installed `webstir` binary; the repo-local `bun run webstir -- <command>` form is for contributors working inside this monorepo. The CLI is optimized for server-first HTML apps with deliberate progressive enhancement, not for broad framework replacement.

## Overview
- Package binary name: `webstir`
- Default packaged install path:
  - create a small tool root
  - `bun add @webstir-io/webstir`
  - invoke the installed binary from `node_modules/.bin/webstir`
- Primary entrypoint in this repo: `bun run webstir -- <command>`
- Works against a workspace root selected with `--workspace <path>` for all mutating or execution commands except `init` and `smoke`
- Reads each app's layers from its files: pages when `src/frontend/` exists, a server when `src/backend/index.ts` exists. Commands follow the layers; `package.json` does not record them
- Command summaries print `layers: pages + server`, `layers: pages`, or `layers: server`; JSON output has `layers: { pages, server }`

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
- `webstir init <starter> <directory>`
- `webstir init <directory>`

What it does:
- Scaffolds a new app from the `full`, `ssg`, `spa`, or `api` starter
- Uses workspace dependencies when the target lives inside this monorepo; uses published package versions for external workspaces
- Creates the selected starter's `src/frontend` and `src/backend` files
- Prints `starter: <name>`

Notes:
- Omitting `<starter>` uses `full`
- The starter only chooses the starting template; nothing records it after init
- Follow with `watch`, `build`, `test`, or `publish` against the new workspace

### refresh
Usage: `webstir refresh <starter> --workspace <path>`

What it does:
- Clears and re-scaffolds an existing, valid Webstir workspace from the selected starter
- Restores the canonical workspace structure without routing through the archived CLI

Notes:
- The target must already contain a valid `package.json` and pages or a server; use `init` for a missing directory
- This is destructive to all contents inside the target directory
- Filesystem roots and the user home directory are always rejected
- Package name and description are preserved, and the selected starter may differ from the one the app started from
- Demo refresh helper scripts in `examples/demos/utils/*.sh` use this Bun path now

### doctor
Usage: `webstir doctor --workspace <path>`

What it does:
- Checks scaffold drift by running the same workspace-aware analysis that powers `repair --dry-run`
- For apps with a server, also validates backend manifest health through the backend build path
- Reports backend migrations in JSON for apps with a server: whether `src/backend/migrations/` exists, how many migrations it holds, and the table that records them
- Accepts `--json` for machine-readable health output

Notes:
- Exits non-zero when it finds repairable scaffold drift or backend manifest/build failures
- Missing scaffold files do not make a workspace unhealthy, since an app may remove starter files; doctor lists them and suggests `repair --restore-scaffold` in case they were removed by mistake
- Use this before `repair` when you want a diagnosis and suggested fix instead of immediately mutating the workspace

### repair
Usage: `webstir repair --workspace <path> [--dry-run] [--restore-scaffold]`

What it does:
- Migrates a workspace to what the installed Webstir expects, adds missing project references and deploy config, re-applies wiring for recorded feature flags like `githubPages`, and removes `webstir.mode` and `webstir.enable.backend`, which older versions wrote to say what an app is
- Takes out of the app what Webstir now does itself, deleting only copies that match what a Webstir version wrote:
  - the dev clients (`hmr.js`, `refresh.js`), which the package serves
  - the hot-module registry and error loader in `app.ts`, and the error reporter `error.ts`, which the app bundle includes; `app.ts` goes when nothing of the app's own is left
  - the feature imports in `app.ts` and `app.css`, and the feature copies older versions wrote, since the flags bring the features in
  - each page stylesheet's `@import "@app/app.css"`, since the build links it on every page
- Leaves anything the app changed in place with a note saying what to do by hand, such as a page that imports from `app.ts` or an edited copy
- Never re-creates missing scaffold files on its own: a mature app may have removed starter files (error pages, starter pages, router files, shared types) on purpose. It lists them as `missingScaffold` instead
- With `--restore-scaffold`, also re-creates every missing scaffold file from the starter that fits the app's layers (pages + server: `full`; server: `api`; pages: `ssg` when `src/frontend/content/` exists, else `spa`) and enabled features, including `AGENTS.md`. Starter tests are never re-created
- Accepts `--json` for machine-readable dry-run or repair output

Notes:
- `--dry-run` reports the edits repair would make, and with `--restore-scaffold` the files it would re-create, without writing anything
- Use `--restore-scaffold` when scaffold files were deleted by mistake and you want them back without the full reset behavior of `refresh`; run it with `--dry-run` first and check the listed paths

### enable
Usage: `webstir enable <feature> [feature-args...] --workspace <path>`

What it does:
- Adds optional enhancements to an existing workspace
- Supported features include `scripts`, `client-nav`, `search`, `content-nav`, `backend`, `sign-in`, `frontend`, `github-pages`, `gh-deploy`, and `s3-cloudfront`
- `backend` also writes `.env.example`, and a `.gitignore` (or the lines an existing one lacks) that keeps `data/`, `.webstir/` and `.env` out of git
- `sign-in` writes `src/backend/sign-in.ts` and the sign-in pages; it needs pages and a server. See [Add Sign-In](../how-to/sign-in.md)
- Updates workspace files and `package.json` flags so the feature is active on the next build/watch
- `client-nav`, `search` and `content-nav` only set their flag: the build brings in the feature and its styles, with nothing imported into the app

Notes:
- Some features accept additional arguments before `--workspace`
- Demo feature-enablement flows now use the Bun orchestrator directly

### operations
Usage: `webstir operations`

What it does:
- Lists the stable Webstir framework operations that the Bun CLI exposes
- Marks which operations mutate a workspace, which support `--json`, and which are ready to wrap through MCP
- Marks the layer an operation needs (`needs: pages` or `needs: server`; `requiresLayer` in JSON)
- Accepts `--json` for a machine-readable operation catalog

Notes:
- This is the contract surface for wrappers and agents; it is intentionally narrower than the full implementation internals

### inspect
Usage: `webstir inspect --workspace <path>`

What it does:
- Runs `doctor` first and then surfaces the stable frontend and backend contract data that apply to the app's layers
- Uses `frontend-inspect` when the app has pages
- Uses `backend-inspect` when the app has a server
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
- Needs an app with pages

### agent
Usage: `webstir agent <inspect|validate|repair|scaffold-page|scaffold-route|scaffold-job> --workspace <path> [goal-args...]`

What it does:
- Runs a thin orchestration layer on top of stable Webstir operations
- Supports inspection, validation, repair, and narrow scaffolding goals without inventing a new app architecture
- Accepts `--json` for machine-readable orchestration results

Notes:
- `inspect` remains the thin agent goal; use top-level `webstir inspect` when you want the direct combined inspection contract
- `validate` runs `doctor` and then `test`
- `repair` runs `doctor`, applies scaffold migrations when available, and then re-checks health; `agent repair --restore-scaffold` also re-creates missing scaffold files
- `scaffold-page`, `scaffold-route`, and `scaffold-job` call the matching scaffold commands and then verify the resulting workspace state
- `scaffold-route` records metadata and reports that the matching application handler still needs implementation and behavioral tests

### build
Usage: `webstir build --workspace <path>`

What it does:
- Builds the selected workspace through the canonical provider packages
- Builds the frontend when the app has pages and the backend when it has a server
- Produces `build/frontend/**` and/or `build/backend/**` depending on the app's layers
- Fails when the app has neither pages nor a server, or when a page has bindings that nothing renders (no view names it and it has no `data.ts`)

### publish
Usage: `webstir publish --workspace <path>`

What it does:
- Produces publish artifacts in `dist/**`
- Reuses the same provider seams as `build`
- Handles the required frontend prebuild before publish output is finalized
- With a server, publishes pages under `dist/frontend/pages/<page>/` for the server to serve
- Without a server, publishes the static layout (`dist/frontend/index.html`, `dist/frontend/<page>/index.html`) and renders views at publish

### watch
Usage: `webstir watch --workspace <path> [--host <host>] [--port <port>] [--verbose]`

What it does:
- Starts the Bun dev loop for the selected workspace
- Builds the frontend of an app with pages with the same pipeline as `build` and serves it, swapping CSS in place and, with client-nav, showing edited page code in place
- Without a server, also renders build-time views as the publish will
- Supervises the backend runtime when the app has a server
- Proxies `/api/*` when the app has pages and a server

Notes:
- Frontend runtime selection is no longer a CLI option
- Every app with pages watches through the same pipeline: CSS edits swap in place, page code edits show the page again in place with client-nav, other edits reload
- A rebuild that fails a build check keeps serving the last valid page
- API watch rebuilds and restarts the backend runtime after successful backend changes
- With pages and a server, watch adds the backend runtime and `/api` proxying to the same frontend watch

### test
Usage: `webstir test --workspace <path> [--runtime <frontend|backend|all>]`

What it does:
- Builds the relevant workspace targets before test execution
- Discovers tests under `src/**/tests/`
- Runs compiled tests through the canonical testing providers
- Supports runtime filtering with `--runtime` or `WEBSTIR_TEST_RUNTIME`

Notes:
- `frontend` only: runs frontend suites when the app has pages
- `backend` only: runs backend suites when the app has a server
- `all` is the default and runs whatever the app's layers support

### smoke
Usage: `webstir smoke [--workspace <path>]`

What it does:
- Runs a bounded end-to-end Bun verification flow:
- `build`
- `test`
- `publish`
  - `doctor`
  - `backend-inspect` for apps with a server
- If `--workspace` is omitted, scaffolds a temporary server-first full workspace from Bun-owned templates
- Prints a compact phase-by-phase summary

Notes:
- The default temporary workspace avoids mutating tracked demo workspaces while still exercising the full Bun-owned smoke surface, while leaving `client-nav` as an opt-in enhancement
- For external copied workspaces, backend type-checking is skipped only when necessary to avoid monorepo-only TypeScript resolution assumptions

### backend-inspect
Usage: `webstir backend-inspect --workspace <path>`

What it does:
- Builds the backend and reads the resulting manifest data
- Prints module metadata, capabilities, routes, views, jobs, and the app's migrations
- Accepts `--json` for machine-readable manifest output
- Needs an app with a server

### mcp
Usage: `webstir mcp`

What it does:
- Runs the Webstir MCP server over stdio
- Exposes the thin stable tool layer for listing operations plus inspect, validate, repair, and scaffold flows
- `repair_workspace` and `repair_dry_run` take an optional `restoreScaffold` boolean, the MCP form of `--restore-scaffold`
- Reuses the existing machine-readable CLI contracts instead of introducing a second control plane

### add-page
Usage: `webstir add-page <name> --workspace <path> [--no-script]`

What it does:
- Scaffolds a frontend page in the selected workspace
- Uses the canonical frontend tooling path rather than a Bun-only fork
- Scaffolds `index.ts` by default; `--no-script` scaffolds a page without it
- The page's `index.css` holds only its own styles; the build links the app's styles ahead of it

### add-island
Usage: `webstir add-island <name> --workspace <path> [--react|--preact|--solid|--svelte|--vue]`

What it does:
- Scaffolds `src/frontend/islands/<name>` in the library a flag names, else the one the app already uses, else plain code with a `mount` function
- Adds the library to `package.json` when the app doesn't have it (run `bun install` afterwards), and for JSX sets the frontend `tsconfig.json`'s JSX options
- Needs an app with pages; see [Islands](../how-to/islands.md)

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
- The server runs the job on its schedule, in `watch` and in production, or when code queues it; see [Run Jobs](../how-to/add-job.md)

### add-migration
Usage: `webstir add-migration <name> --workspace <path> [--ts]`

What it does:
- Writes the next migration in `src/backend/migrations/`, numbered after the last: `0003-<name>.sql`, or `.ts` exporting `up(db)` with `--ts`
- Refuses a name another migration already has
- The server applies it once, when it next starts; see [Use the Database](../how-to/database.md)

### migrate
Usage: `webstir migrate --workspace <path> [--status]`

What it does:
- Builds the backend and applies the app's pending migrations to the database `DATABASE_URL` names, as the server does when it starts
- `--status` lists each migration and when it was applied, without changing anything

### jobs
Usage:
- `webstir jobs --workspace <path>`
- `webstir jobs run <name> --workspace <path> [--payload <json>]`

What it does:
- Lists the app's jobs with their schedules, the queue by status, and failed jobs with their errors
- `run` builds the backend and runs one job now, in the CLI's process, with the payload given

## Dependency Management
- There is no Bun `webstir install` command.
- Manage workspace dependencies with `bun install`.
- Provider-specific packages are normal workspace dependencies, not a separate framework-managed install flow.

## Related Docs
- Solution — [solution](../explanations/solution.md)
- Test workflow — [test](../how-to/test.md)
- Add test — [add-test](../how-to/add-test.md)
- Demos — [examples/demos/README.md](https://github.com/webstir-io/webstir/blob/main/examples/demos/README.md)
