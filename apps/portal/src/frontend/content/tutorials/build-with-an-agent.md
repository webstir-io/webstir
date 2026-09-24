# Build with a coding agent

Use a coding agent to build and change a server-first Webstir app. The agent edits your application; Webstir provides the project structure, inspection, scaffolding, and checks.

Generated `AGENTS.md` instructions, installed feature recipes, and repair that preserves deliberately removed starter tests require Webstir `0.1.67` or later. Earlier versions support the basic CLI workflow below. This guide does not claim a measured speedup or support for every agent product.

## Start a consumer workspace

Follow [Getting Started](./getting-started.md) to install the CLI and create a `full` app. Keep the absolute path to the installed executable:

```sh
mkdir webstir-playground
cd webstir-playground
printf '{"name":"webstir-playground","private":true}\n' > package.json
bun add @webstir-io/webstir
WEBSTIR="$PWD/node_modules/.bin/webstir"
"$WEBSTIR" init full my-app
cd my-app
bun install
"$WEBSTIR" inspect --json --workspace "$PWD"
```

Open `my-app` in your coding agent. Supply the absolute CLI path in its first request; a new terminal or agent session does not inherit a previous shell's `WEBSTIR` variable. The initial integration is exercised with Codex CLI. Other agents can use the CLI, but need their own verification before assuming equivalent behavior.

In Webstir `0.1.67` and later, `--help` prints the installed recipe directory and current starter instructions. New apps include a short `AGENTS.md`; read it alongside the app's existing code. Existing instruction files belong to the app and are preserved by repair. Missing instructions alone do not make an app unhealthy.

## Ask for a complete feature

Use a request with visible behavior and a clear finish line. Supply your actual installed CLI path with this example:

> Add a single-user notes page at /api/notes. Support creating, editing, and deleting notes, with a required title and persistence across server restarts. Keep the forms working without JavaScript. Reuse the installed notes recipe when available, preserve the existing pages, and add application tests for valid and invalid submissions. Use the app's installed Webstir CLI to build and test, then verify the user flow in a browser. Report what you changed and any checks you could not complete.

The notes recipe creates its own SQLite helper. The default `full` scaffold does not include an ORM or a production authentication system. For private multi-user data, use a verified identity provider and enforce ownership in the application; the starter session demo is not an authentication implementation.

## Change the app

After reviewing the first result, give the agent a second task:

> Add open/done status to notes and a native filter form. Existing notes should remain intact and default to open. Reject invalid status values on the server. Preserve the existing CRUD behavior and verify filtering and persistence after restarting the server.

For an app that already has authentication, the installed projects recipe shows how to add status/filtering while retaining its trusted identity boundary and owner-scoped queries. Adopt the relevant pattern rather than replacing the app's authentication or data model.

## Check the result

Run the app's tests and exercise the requested behavior yourself:

```sh
"$WEBSTIR" test --workspace "$PWD"
"$WEBSTIR" watch --workspace "$PWD"
```

Check successful submissions, invalid input, reloads, and persistence after restart. For authenticated apps, check anonymous access and a second user's records too. Passing starter tests does not demonstrate that a newly requested feature works.

`add-route` records route metadata; the application still needs a matching handler. `inspect` describes framework state, and `agent validate` runs diagnosis plus tests. Use the behavior you requested as the acceptance criteria.

When diagnosing scaffold drift, start with `repair --dry-run --json --workspace "$PWD"`. In Webstir `0.1.67` and later, repair restores framework support files while leaving app-owned instructions and starter tests under your control. Older versions may recreate deleted starter tests, so inspect the proposed paths before applying repair. Application bugs require application code changes. `refresh` replaces the workspace with a scaffold and is unsuitable for routine repair.

## Optional MCP connection

An MCP-capable coding agent can launch the same installed executable with the `mcp` argument using a stdio connection. Provide the absolute executable path in that agent's configuration and follow its documentation for approvals and project access. This exposes inspection, scaffolding, validation, and repair through the same framework operations; the CLI remains sufficient for this tutorial.

## Evidence and availability

The repository's `tools/agent-eval/` harness evaluates build, extend, and repair tasks through installed packages and independent browser checks. It retains unsuccessful attempts and distinguishes environment errors from task failures. Its results are a bounded experiment in one local agent environment, not a comparison with other frameworks.

See the [evaluation report](https://github.com/webstir-io/webstir/blob/main/plans/agent-assisted-development/RESULTS.md) for the package artifacts, full sample, and limitations.

Package publication is separate from merging framework changes. Verify your installed version and its `--help` output before relying on newly documented package features.
