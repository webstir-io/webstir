# webstir

Bun-first orchestrator experiments for the Webstir monorepo.

Primary command name: `webstir`

Current scope:

- `build --workspace <path>`
- supports `spa`, `ssg`, `api`, and `full` workspace modes
- validates against the existing provider packages instead of copying framework logic

Run it from the repo root with:

```bash
bun run webstir -- build --workspace /absolute/path/to/workspace
```
