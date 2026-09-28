# Docker Deployment

Use Docker as the supported deployment contract today for published `api` and `full` Webstir workspaces.

Webstir is still experimental, but this is the one Bun deployment path the repo supports and tests end to end right now. Treat other deployment shapes as out of contract unless the docs start naming them explicitly.

## Command Flow

From the workspace root:

```bash
webstir publish --workspace "$PWD"
docker build -t my-webstir-app .
docker run --rm -p 8080:8080 -v my-webstir-data:/app/data --env-file ./.env.production my-webstir-app
```

## Dockerfile

Use the canonical Dockerfile and `.dockerignore` in the workspace root:

```dockerfile
FROM oven/bun:1.3.11-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["bun", "./node_modules/.bin/webstir-backend-deploy", "--workspace", "/app", "--port", "8080"]
```

## Runtime Contract

- The deploy reads what the app is from `build/published-layers.json`, which publish writes, since the image carries no `src/`. An app recorded with pages whose `dist/frontend/` is missing fails at startup rather than serving only its API.
- An app without pages exposes the published backend on the container port.
- An app with pages exposes one public port that serves `dist/frontend/**` and proxies `/api/*` to the published backend.
- `dist/frontend/**` is only there for an app with pages; an app without pages builds the image without a `dist` tree.
- The single public port keeps the runtime probes available without a second sidecar port:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /metrics`
- `/metrics` reports request counts and timings; `METRICS_ENABLED=off` turns them off and it returns `{ "enabled": false }`.
- `/app/data` holds the SQLite database and stored files by default: mount a volume there so they outlive the container, or point `DATABASE_URL` at Postgres and `STORAGE_URL` at S3.
- Migrations apply when the container starts; one that fails stops it with its file and error.
- `SESSION_SECRET` is required in production. With sign-in, so are `APP_URL`, `EMAIL_URL` and `EMAIL_FROM`. See [Environment](../reference/env.md).
- Only published apps with a server are in contract for this deploy path; an app without one publishes as a static site.

## Canonical Source

- Repo source: `orchestrators/bun/resources/deployment/docker/**`
- Packaged copy: `orchestrators/bun/assets/deployment/docker/**`

## Related Docs

- [Publish](./publish.md)
- [Static Sites](./static-sites.md)
- [Workflows](../reference/workflows.md)
