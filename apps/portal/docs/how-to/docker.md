# Docker Deployment

Use Docker as the official production contract for published `api` and `full` Webstir workspaces.

## Command Flow

From the workspace root:

```bash
webstir publish --workspace "$PWD"
docker build -t my-webstir-app .
docker run --rm -p 8080:8080 --env-file ./.env.production my-webstir-app
```

## Dockerfile

Use the canonical Dockerfile and `.dockerignore` in the workspace root:

```dockerfile
FROM oven/bun:1.3.10-alpine

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

- `api` workspaces expose the published backend on the container port.
- `full` workspaces expose one public port that serves `dist/frontend/**` and proxies `/api/*` to the published backend.
- `dist/frontend/**` is only required for `full`; `api` workspaces can build the image without a `dist` tree.
- Health and readiness stay available on the same public port:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /metrics`
- `SESSION_SECRET` is required in production for the default Bun backend scaffold.

## Canonical Source

- Repo source: `orchestrators/bun/resources/deployment/docker/**`
- Packaged copy: `orchestrators/bun/assets/deployment/docker/**`

## Related Docs

- [Publish](./publish.md)
- [Static Sites](./static-sites.md)
- [Workflows](../reference/workflows.md)
