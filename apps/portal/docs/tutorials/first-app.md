# Your First App

Build a small HTML-first full-stack app, then validate it through the same watch, test, and publish flow used by the proof apps.

## Create The App

```bash
bun run webstir -- init my-first-app
cd my-first-app
bun install
```

## Run In Dev Mode

```bash
bun run webstir -- watch --workspace "$PWD"
```

This starts the frontend dev server plus the backend runtime when `src/backend` exists. The watch loop keeps document assets and `/api/*` responses in sync.

## Add A Page

```bash
bun run webstir -- add-page about --workspace "$PWD"
```

Open `/about`, edit files under `src/frontend/pages/about/`, and watch the document rebuild.

## Add A Backend Form Flow

Use `src/backend/index.ts` or `src/backend/module.ts` to add:

- a GET document route
- a POST form handler that redirects back to the document
- an enhanced fragment response when `x-webstir-client-nav: 1` is present

The repo proof apps show the target shape:

- [`examples/demos/auth-crud`](https://github.com/webstir-io/webstir/tree/main/examples/demos/auth-crud)
- [`examples/demos/dashboard`](https://github.com/webstir-io/webstir/tree/main/examples/demos/dashboard)

## Test And Publish

```bash
bun run webstir -- test --workspace "$PWD"
bun run webstir -- publish --workspace "$PWD"
```

Inspect:

- `build/frontend/**` and `build/backend/**` for watch/build output
- `dist/frontend/**` for publish-ready assets

## Next

- [Solution Overview](../explanations/solution.md)
- [Watch](../how-to/watch.md)
- [Publish](../how-to/publish.md)
