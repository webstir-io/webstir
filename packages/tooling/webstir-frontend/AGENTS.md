# AGENTS.md (Repo Stub)

This package follows the monorepo baseline at the repo root `AGENTS.md`.

- Scope: Frontend module provider and CLI.
- Start here: `README.md` and `package.json` exports.
- Precedence: org baseline; add repo-specific rules here if needed.
- Release note: npm tarball ships `src/`, `scripts/`, `tests/`, and `tsconfig.json` so downstream tooling can rebuild without cloning; keep them publish-ready.
- Use `bun run release -- <patch|minor|major>` (scripts/publish.sh) for version bumps; it enforces clean git + build/test/smoke and pushes a package-scoped release tag for the monorepo workflow.
- Run `bun run sync:framework-embedded` after canonical manifest changes when you are not using the release helper; the release helper syncs its target package automatically.
