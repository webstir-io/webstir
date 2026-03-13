# webstir-demos

Helper scripts:
- `utils/watch-demo.sh <ssg|spa|api|full|auth-crud> [base|site] [<webstir-watch-args...>]` — start Bun watch without re-initializing.
- `utils/enable-feature.sh <project|ssg|ssg-base|ssg-site|spa|api|full|auth-crud> <feature> [<feature-args...>]` — enable a feature in a demo or any project folder.

Demo folders:
- `api/` — backend-only
- `auth-crud/` — fullstack auth and CRUD proof app for server-handled forms
- `full/` — fullstack (frontend + backend)
- `spa/` — SPA frontend
- `ssg/base/` — SSG starter (no optional features enabled)
- `ssg/site/` — SSG starter (features enabled; see `utils/refresh-ssg.sh site`)

Convenience scripts:
- `utils/refresh-ssg.sh <base|site>` / `utils/watch-ssg.sh <base|site>`
- `utils/refresh-spa.sh` / `utils/watch-spa.sh`
- `utils/refresh-api.sh` / `utils/watch-api.sh`
- `utils/refresh-full.sh` / `utils/watch-full.sh`
- `utils/refresh-auth-crud.sh` / `utils/watch-auth-crud.sh`
- `utils/serve-demo.sh <ssg|spa|api|full> [base|site] [--host <host>] [--port <port>]`
- `utils/serve-ssg.sh <base|site>`

Root shortcuts:
- `bun run watch:spa`
- `bun run watch:ssg:base`
- `bun run watch:ssg:site`
- `bun run watch:api`
- `bun run watch:full`
- `bun run watch:auth-crud`

Notes:
- Watch, feature-enable, and refresh helpers use the Bun orchestrator.
