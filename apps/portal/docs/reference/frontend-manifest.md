# Webstir Frontend Manifest

| Field | Description |
| --- | --- |
| `version` | Schema version. Always `1` for the initial rollout. |
| `paths.workspace` | Absolute path to the workspace root sent from the CLI. |
| `paths.src.root` | `src` directory under the workspace. |
| `paths.src.frontend` | `src/frontend` directory housing the app, pages, assets. |
| `paths.src.app` | `src/frontend/app` directory for shared templates and scripts. |
| `paths.src.pages` | `src/frontend/pages` directory containing page-specific assets. |
| `paths.src.content` | `src/frontend/content` directory for Markdown/content inputs. |
| `paths.src.images` | `src/frontend/images` source assets. |
| `paths.src.fonts` | `src/frontend/fonts` source assets. |
| `paths.src.media` | `src/frontend/media` source assets. |
| `paths.build.root` | `build` directory root for intermediate artifacts. |
| `paths.build.frontend` | `build/frontend` directory containing compiled assets. |
| `paths.build.app` | `build/frontend/app` directory mirrored from the source app template. |
| `paths.build.pages` | `build/frontend/pages` directory for page-level HTML/JS/CSS artifacts. |
| `paths.build.content` | `build/frontend/content` directory for generated content artifacts. |
| `paths.build.images` | `build/frontend/images` directory with copied image assets. |
| `paths.build.fonts` | `build/frontend/fonts` directory with copied font assets. |
| `paths.build.media` | `build/frontend/media` directory with copied media assets. |
| `paths.dist.root` | `dist` directory root for publish artifacts. |
| `paths.dist.frontend` | `dist/frontend` directory containing production assets. |
| `paths.dist.app` | `dist/frontend/app` directory for any frontend app-level artifacts. |
| `paths.dist.pages` | `dist/frontend/pages` directory containing page bundles. |
| `paths.dist.content` | `dist/frontend/content` directory for generated publish-time content artifacts. |
| `paths.dist.images` | `dist/frontend/images` directory containing optimized images. |
| `paths.dist.fonts` | `dist/frontend/fonts` directory containing fonts. |
| `paths.dist.media` | `dist/frontend/media` directory containing media assets. |
| `features.htmlSecurity` | Enables CSP/SRI/transformers when `true`. |
| `features.imageOptimization` | Enables WebP/AVIF generation and sanitization when `true`. |
| `features.precompression` | Enables `.br`/`.gz` precompressed outputs when `true`. |

## Location
The manifest is emitted to:

```
.webstir/frontend-manifest.json
```

relative to the workspace root. The TypeScript CLI ensures the `.webstir` directory exists and writes the manifest atomically on every `build`, `publish`, or `rebuild` command.

## Purpose
- Written by `@webstir-io/webstir-frontend` whenever it prepares a workspace for `build`, `publish`, `rebuild`, or watch startup.
- Captures the resolved path layout and feature flags that the frontend package will use for that workspace.
- Makes the generated workspace state inspectable without re-deriving paths by hand.

This file is generated state, not the primary source of truth. The canonical schema lives in the frontend package.

## Validation
The canonical schema lives in `packages/tooling/webstir-frontend/src/config/schema.ts`. That TypeScript source is the active contract for the Bun-based Webstir toolchain.
