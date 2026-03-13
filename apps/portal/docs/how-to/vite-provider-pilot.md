# Vite Frontend Provider

Historical pilot only.

The active Bun CLI does not support swapping the frontend provider through `webstir.providers.json` or `WEBSTIR_FRONTEND_PROVIDER`, so the older Vite-provider flow documented here is not part of the live product surface.

## Current Reality

- `webstir` always loads `@webstir-io/webstir-frontend` for frontend work.
- The Vite pilot steps from older docs will not work against the current orchestrator as written.
- If provider-swapping work resumes, it should be documented again from the live implementation rather than these archived instructions.

## Use Instead

- Canonical frontend workflow: [build](./build.md), [watch](./watch.md), and [publish](./publish.md)
- Package-level frontend CLI: `npx webstir-frontend ...`
- Current provider status: [provider selection](./provider-selection.md)
