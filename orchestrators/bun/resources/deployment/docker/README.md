# Webstir Docker Deployment

Canonical Bun deployment contract for published apps with a server.

## Workspace Prerequisites

Run from the workspace root after a publish:

```bash
webstir publish --workspace "$PWD"
```

Required inputs in the workspace root:

- `package.json`
- `bun.lock`
- `build/backend/**`
- `dist/frontend/**` for apps with pages
- The canonical `.dockerignore`

## Build

Copy the canonical `Dockerfile` and `.dockerignore` into your workspace root, then build:

```bash
docker build -t my-webstir-app .
```

## Run

```bash
docker run --rm \
  -p 8080:8080 \
  --env-file ./.env.production \
  my-webstir-app
```

The container starts `webstir-backend-deploy`, which:

- runs the published backend under Bun
- serves `dist/frontend/**` for apps with pages
- proxies `/api/*` to the backend runtime for apps with pages
- proxies all requests to the backend for apps without pages
- reads whether the app has pages from `build/published-layers.json`, which publish writes (the image carries no `src/`), and fails at startup when an app recorded with pages has no `dist/frontend/**`
- keeps `/readyz`, `/healthz`, and `/metrics` available from the single public port
