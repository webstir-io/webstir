# Your First App

Build a small server-first HTML app with the packaged CLI, then validate the same watch, test, and publish loop you will use in a real workspace.

## Start From A Fresh Workspace

This tutorial assumes you already installed the CLI as shown in [Getting Started](./getting-started.md) and still have the absolute `WEBSTIR` path in your shell.

```bash
"$WEBSTIR" init full my-first-app
cd my-first-app
bun install
```

## Run In Dev Mode

```bash
"$WEBSTIR" watch --workspace "$PWD"
```

This starts the frontend dev server plus the backend runtime. The watch loop keeps document assets and `/api/*` responses in sync.

## Walk The Built-In Form Flow

Open `/api/demo/progressive-enhancement` and compare two cases:

1. Submit the form with JavaScript disabled or with no enhancement enabled. The backend follows the baseline redirect-after-post path.
2. Keep the same route as your reference when you add auth gates, validation recovery, or other server-side behaviors.

That route lives in `src/backend/module.ts`. The scaffold keeps `src/backend/index.ts` as a thin Bun bootstrap entry, while `module.ts` holds the demo route logic and gives you a working reference for:

- `application/x-www-form-urlencoded` form handling
- redirect responses for the baseline HTML path
- the same server-first structure you can extend with auth and optional fragment responses later

## Opt Into Client Navigation Later

If your app benefits from fragment updates, add `client-nav` after the baseline HTML flow is already working:

```bash
"$WEBSTIR" enable client-nav --workspace "$PWD"
```

Then re-run the same form flow and compare the fragment-enhanced result with the redirect-after-post fallback.

## Add A Page

```bash
"$WEBSTIR" add-page about --workspace "$PWD"
```

Open `/about`, edit files under `src/frontend/pages/about/`, and watch the document rebuild.

## Adapt The Backend Demo

To make the scaffold feel like your app instead of the stock demo, start by editing the existing backend route in `src/backend/module.ts`:

- change `DEMO_PATH` to the route you actually want
- rename the route summaries
- replace the HTML in `renderGreeting()` with your own document or fragment markup

Once that is working, split the demo helpers into your own route handlers or module exports as the backend surface grows.

## Validate The Workspace

```bash
"$WEBSTIR" test --workspace "$PWD"
"$WEBSTIR" publish --workspace "$PWD"
```

Inspect:

- `build/frontend/**` and `build/backend/**` for watch/build output
- `dist/frontend/**` for publish-ready assets

## Next

- [Solution Overview](../explanations/solution.md)
- [Watch](../how-to/watch.md)
- [Publish](../how-to/publish.md)
