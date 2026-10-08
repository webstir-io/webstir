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

## Stopping

A container is stopped with `SIGTERM`, by `docker stop`, a deploy or a restart. The server then:

1. Takes no new connections, and lets the requests in flight finish.
2. Stops its jobs. A job still running when the wait ends goes back in the queue at the next start.
3. Closes the database, taking a SQLite database's pending snapshot, and exits with `0`.

`SHUTDOWN_TIMEOUT` is how long each wait lasts, 4 seconds by default. In an app with pages the public server waits for its requests first and then the app server waits for its jobs, so a stop can take twice the setting, plus a second to close the database. That fits the 10 seconds Docker allows before it kills a container. An app with slower requests raises both:

```bash
docker run --stop-timeout 30 -e SHUTDOWN_TIMEOUT=14 ...
```

A second `SIGTERM` stops the wait and exits at once with `1`.

## Canonical Source

- Repo source: `orchestrators/bun/resources/deployment/docker/**`
- Packaged copy: `orchestrators/bun/assets/deployment/docker/**`

## Related Docs

- [Publish](./publish.md)
- [Static Sites](./static-sites.md)
- [Workflows](../reference/workflows.md)
