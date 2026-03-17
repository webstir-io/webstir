# @webstir-io/webstir-frontend

HTML-first frontend delivery for Webstir workspaces. This package builds page documents, shared app assets, CSS, and browser-side enhancement scripts for applications that start with server-rendered HTML and selectively add JavaScript where it improves the experience.

## What It Ships

- Multi-page HTML/CSS/JS builds for `src/frontend/**`
- Publish output with fingerprinted assets under `dist/frontend/**`
- Watch-mode rebuilds used by the Bun orchestrator
- Shared app-shell assets such as navigation, refresh, and client enhancement hooks
- SSG as a supported mode, without making static-only delivery the center of the product story

Requires Bun **1.3.5** or newer.

## HTML-First Workflow

The frontend package is designed to pair with the backend runtime rather than replace it:

- Build document shells under `build/frontend/pages/**`
- Publish optimized assets under `dist/frontend/**`
- Let backend routes or request-time views deliver HTML first
- Use enhancement scripts for fragment updates, navigation polish, and form handling when JavaScript is available

Canonical proof apps in this repo:

- [`examples/demos/auth-crud`](../../../examples/demos/auth-crud) for server-handled auth, validation, redirect-after-post, and CRUD flows
- [`examples/demos/dashboard`](../../../examples/demos/dashboard) for shell-level and panel-level partial refreshes without SPA architecture

## Quick Start

1. Install the package

```bash
bun add @webstir-io/webstir-frontend
```

2. Build a workspace

```bash
bunx webstir-frontend build --workspace /absolute/path/to/workspace
```

3. Publish optimized frontend assets

```bash
bunx webstir-frontend publish --workspace /absolute/path/to/workspace
```

## Workspace Layout

```text
workspace/
  src/frontend/
    app/
    pages/
    images/
    fonts/
    media/
    frontend.config.json   # optional feature flags
    webstir.config.mjs     # optional hooks
  build/frontend/...       # watch/build output
  dist/frontend/...        # publish output
  .webstir/manifest.json   # pipeline manifest
```

## CLI Commands

Binary name: `webstir-frontend`. All commands require `--workspace`.

| Command | Description | Useful options |
| --- | --- | --- |
| `build` | Runs the development-oriented pipeline. | `--changed-file <path>` to scope rebuilds. |
| `publish` | Produces optimized frontend assets. | `--mode <bundle\|ssg>` |
| `rebuild` | Incremental rebuild after a file change. | `--changed-file <path>` |
| `add-page <name>` | Scaffolds `index.html`, `index.css`, and `index.ts`. | None |
| `watch-daemon` | Persistent watcher + HMR coordinator. | `--no-auto-start`, `--verbose`, `--hmr-verbose` |

## Feature Flags

`frontend.config.json` controls optional pipeline features:

```jsonc
{
  "features": {
    "htmlSecurity": true,
    "externalResourceIntegrity": false,
    "imageOptimization": true,
    "precompression": false
  }
}
```

`externalResourceIntegrity` stays `false` by default so publish does not fetch third-party script or stylesheet URLs just to compute SRI. Enable it only when you explicitly want remote fetches during publish; otherwise, add `integrity` and `crossorigin` attributes yourself for external CDN assets.

## Lifecycle Hooks

Hooks live in `webstir.config.mjs` (or `.js` / `.cjs`) at the workspace root:

```js
export const hooks = {
  pipeline: {
    beforeAll({ mode }) {
      console.info(`[webstir] starting ${mode} pipeline`);
    }
  },
  builders: {
    assets: {
      after() {
        // custom post-processing
      }
    }
  }
};
```

## API Usage

```ts
import { frontendProvider } from '@webstir-io/webstir-frontend';

const result = await frontendProvider.build({
  workspaceRoot: '/absolute/path/to/workspace',
  env: { WEBSTIR_MODULE_MODE: 'publish' }
});

console.log(result.manifest.entryPoints);
```

- `frontendProvider.metadata` exposes package and runtime-compatibility metadata
- `frontendProvider.resolveWorkspace()` returns canonical source/build roots
- `frontendProvider.build()` executes the pipeline and returns artifacts plus manifest data

## SSG Mode

SSG is a supported frontend output mode, not a separate product:

```bash
bunx webstir-frontend publish --workspace /absolute/path/to/workspace --mode ssg
```

That run:

- Builds normal publish assets under `dist/frontend/**`
- Generates `index.html` aliases for document routes
- Uses `webstir.moduleManifest.views` metadata when present to emit extra static paths

## Maintainer Workflow

```bash
bun install
bun run clean
bun run build
bun run test
bun run release -- patch
```

Recommended package validation before release:

- `bun run build`
- `bun run test`

## Troubleshooting

- `No frontend test files found`
  The package test script expects compiled tests under `tests/**/*.test.js`.
- `Missing entry points in manifest`
  Confirm `build/frontend` contains at least one generated JS entry.
- `SSG output missing a route`
  Check `webstir.moduleManifest.views` for `renderMode: "ssg"` and the expected `staticPaths`.

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md

## Third-Party Notices

Webstir Frontend depends on third-party libraries and data sets (including `sharp` / libvips and `caniuse-lite`) under their respective licenses. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the attribution summary.

## License

MIT © Webstir
