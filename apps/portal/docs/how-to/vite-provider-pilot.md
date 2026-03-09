# Vite Frontend Provider

This guide shows how to use the Vite-powered frontend module provider with Webstir.

## Prerequisites
- Workspace created with `webstir init` (fullstack or frontend).
- Dependencies restored with `bun install`.
- Provider package available: `@webstir-io/vite-frontend` (install from the registry).

## Quick Start
1. Install the provider (once per workspace):

    ```bash
    bun add -d @webstir-io/vite-frontend
    ```

2. Update `webstir.providers.json` in the workspace root:

    ```json
    {
      "frontend": "@webstir-io/vite-frontend"
    }
    ```

3. Install or refresh dependencies if the workspace graph changed:

    ```bash
    bun install
    ```

4. Run build/publish:

    ```bash
    webstir build
    webstir publish
    ```

Use `WEBSTIR_FRONTEND_PROVIDER` for ad-hoc overrides. Logs include provider id, entry points, and diagnostics from the Bun orchestrator.

## Watch Mode
```bash
WEBSTIR_FRONTEND_PROVIDER=@webstir-io/vite-frontend webstir watch
```

Hot-update diagnostics flow through the same provider manifest; tail the CLI output to validate HMR behaviour.

> Tip: For unpublished builds from the standalone repository, set `WEBSTIR_FRONTEND_PROVIDER_SPEC=<path-to-local-vite-provider>` (for example `/path/to/vite-frontend-checkout`) so the workflow resolves your local checkout instead of the published package.

## Notes
- Provider selection also affects `webstir test` when it triggers frontend builds.
- Keep `webstir.providers.json` in sync with the dependencies committed to the workspace.
- Backend swaps use `WEBSTIR_BACKEND_PROVIDER` (see `Docs/how-to/provider-selection.md`).
- Regression coverage: `Tester.Workflows.Build.BuildWorkflowTests.BuildWithViteProviderProducesArtifacts` exercises the provider end-to-end.
