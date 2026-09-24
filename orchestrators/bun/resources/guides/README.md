# Build a Webstir app with a coding agent

Start with Codex and a `full` app. The normal CLI is enough; Webstir does not require an agent plugin or access to its framework checkout.

## One setup path

Install the CLI in a tools directory beside the app so its version stays separate from application dependencies:

```sh
mkdir webstir-tools
cd webstir-tools
bun init -y
bun add @webstir-io/webstir
export WEBSTIR="$PWD/node_modules/.bin/webstir"
"$WEBSTIR" init full ../my-app
cd ../my-app
bun install
"$WEBSTIR" agent inspect --workspace "$PWD" --json
"$WEBSTIR" build --workspace "$PWD"
"$WEBSTIR" test --workspace "$PWD"
"$WEBSTIR" watch --workspace "$PWD"
```

Use a tested candidate tarball instead of the package name when evaluating an unreleased build. Keep the tools directory's lockfile; it records the exact installed CLI and dependency versions. `WEBSTIR` is an absolute executable path, so changing into the app does not lose the CLI. In another terminal, set it to that same absolute path again.

Open the generated app folder in Codex. Ask it to read the app's `AGENTS.md`, inspect the workspace, and implement a concrete feature with application-specific checks. Give it the `WEBSTIR` path and the URL printed by watch. Keep `src/**`, application tests, configuration, and data migrations in the app; `build/`, `dist/`, and installed package files are generated/dependency output.

For example:

> Read AGENTS.md and the installed notes recipe. Add persistent create/edit/delete notes with title validation. Keep native HTML forms working without JavaScript. Use the supplied absolute Webstir executable and workspace path. Add application tests, verify the browser flow and restart persistence, and report the checks and anything unverified.

## Complete features, then verify them

- [Persisted notes](recipes/notes/README.md) includes real handlers, SQLite, HTML, validation, CSRF, and a copyable HTTP test.
- [Authenticated status and filtering](recipes/projects/README.md) preserves an existing identity boundary and scopes every data operation by owner.

Append implemented routes in `src/backend/module.ts` and keep the exported manifest in sync. `add-route` and `agent scaffold-route` scaffold route metadata; they do not create your handler, data storage, or complete feature. Backend runtime form helpers are available through `@webstir-io/webstir-backend/runtime/forms`.

Run focused application checks, then `"$WEBSTIR" agent validate --workspace "$PWD" --json`. Starter tests passing means the starter still works. It does not prove that your new feature stores data, rejects invalid writes, protects other users' records, or renders correctly. Check those outcomes explicitly with test data and a browser.

## Diagnose and preserve app work

Use `"$WEBSTIR" doctor --workspace "$PWD" --json` to inspect scaffold/runtime health. Preview scaffold restoration with `"$WEBSTIR" repair --workspace "$PWD" --dry-run`; review its listed paths before applying. Repair restores missing scaffold-owned files. It does not diagnose or fix arbitrary application logic. Avoid `refresh` when preserving a customized app: it resets and re-scaffolds the workspace.

Keep user-authored instructions when upgrading. Follow the generated `AGENTS.md` preservation policy; compare the new installed guidance and deliberately merge useful changes. Do not overwrite local rules just to match a newer template.

MCP is optional. Run the same absolute executable with the single argument `mcp` as a stdio MCP server; tools accept the workspace path per operation. `mcp` takes no CLI workspace option. The operations use the same framework capabilities as the CLI, and do not provide missing application handlers or an alternate correctness signal.
