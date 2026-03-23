# Sandbox

Run a published Webstir workspace behind nginx with the Bun-owned Compose example. Use this to validate `dist/frontend/**` and `build/backend/**` without the dev server.

## Helper Files

- Compose — `orchestrators/bun/resources/deployment/sandbox/docker-compose.yml`
- nginx site config — `orchestrators/bun/resources/deployment/sandbox/web/nginx.conf`
- The Bun package syncs this repo source into `orchestrators/bun/assets/deployment/sandbox/**` for packing and local package use.

## Prerequisites

- Docker and Docker Compose installed.
- A workspace that has already been built and published:
  - Frontend: `dist/frontend/**` from `webstir publish`
  - Backend: `build/backend/index.js` from `webstir build`

## Usage

```bash
WEBSTIR_WORKSPACE=/absolute/path/to/workspace \
  docker compose -f orchestrators/bun/resources/deployment/sandbox/docker-compose.yml up --build -d
```

- Open: `http://localhost:8080` for the published site
- Open: `http://localhost:8000` for the API server
- Logs: `docker compose -f orchestrators/bun/resources/deployment/sandbox/docker-compose.yml logs -f web` or `... logs -f api`
- Stop: `docker compose -f orchestrators/bun/resources/deployment/sandbox/docker-compose.yml down`

## Mounts

- `dist/frontend` mounts into nginx as the published web root.
- The workspace root mounts into the API container so `node build/backend/index.js` runs the compiled backend output.

## Nginx Behavior

- Clean URLs resolve to `pages/<page>/index.html`.
- `/api/*` is proxied to the API container with the `/api` prefix stripped.
- Fingerprinted assets get a long cache lifetime.
- HTML stays uncached.
- Source maps return `404`.

## Troubleshooting

- 404s for pages: confirm `dist/frontend/pages/<page>/index.html` exists in the published workspace.
- 404s for assets: confirm the corresponding fingerprinted CSS or JS file exists under `dist/frontend/pages/<page>/`.
- API errors: inspect the `api` container logs and confirm `build/backend/index.js` exists in the workspace.

## Related Docs

- Solution overview — [solution](../explanations/solution.md)
- CLI reference — [cli](../reference/cli.md)
- Workflows — [workflows](../reference/workflows.md)
- Pipelines — [pipelines](../explanations/pipelines.md)
