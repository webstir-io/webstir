# Webstir Docker Deployment

Canonical Docker deployment contract for published `api` and `full` workspaces.

## Workspace Prerequisites

Run from the workspace root after a publish:

```bash
webstir publish --workspace "$PWD"
```

Required inputs in the workspace root:

- `package.json`
- `bun.lock`
- `build/backend/**`
- `dist/frontend/**` for `full` workspaces
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
- serves `dist/frontend/**` for `full` workspaces
- proxies `/api/*` to the backend runtime for `full` workspaces
- proxies all requests to the backend for `api` workspaces
- keeps `/readyz`, `/healthz`, and `/metrics` available from the single public port
