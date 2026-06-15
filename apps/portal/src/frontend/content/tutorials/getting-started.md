# Getting Started

Install the packaged CLI, scaffold a server-first workspace outside the monorepo, and run the built-in full template.

> These docs default to the packaged CLI path. If you are contributing inside this repo, use `bun run webstir -- ...` from the monorepo root instead.

## Prerequisites

- Bun 1.3.x
- Node.js 20.18+

## Install The CLI

Create a small tool root for the CLI, install it once, and keep the binary path around for the rest of the tutorial:

```bash
mkdir webstir-playground
cd webstir-playground
printf '{\n  "name": "webstir-playground",\n  "private": true\n}\n' > package.json
bun add @webstir-io/webstir
WEBSTIR="$PWD/node_modules/.bin/webstir"
```

Check the installed command surface:

```bash
"$WEBSTIR" --help
```

## Scaffold A Workspace

```bash
"$WEBSTIR" init full my-first-app
cd my-first-app
bun install
```

## Run The App

```bash
"$WEBSTIR" watch --workspace "$PWD"
```

Open the printed URL, then check both of these routes:

- `/` for the scaffolded document shell
- `/api/demo/progressive-enhancement` for the built-in backend form flow that demonstrates the baseline redirect-after-post path before any optional `client-nav` enhancement

The default app should work without JavaScript for forms, links, redirects, and auth-gated flows.

## Next

- [Your First App](./first-app.md)
- [Watch](../how-to/watch.md)
- [Test](../how-to/test.md)
- [Publish](../how-to/publish.md)

## Repo Contributor Path

If you are working inside this monorepo instead of consuming Webstir as a packaged tool, use the repo-root command form:

```bash
bun install
bun run webstir -- watch --workspace "$PWD/examples/demos/full"
```
