# Add a Backend Job

Scaffold a job stub and record it in the module manifest.

## Prerequisites
- A Webstir workspace initialized via `webstir init ...`.
- Backend source at `src/backend/`.

## Steps
1. Create a job named `cleanup`:
   - `webstir add-job cleanup --workspace "$PWD"`
   - Creates `src/backend/jobs/cleanup/index.ts` with a `run()` function.
   - Adds `{ name: "cleanup" }` to `webstir.moduleManifest.jobs` in `package.json`.
2. Add metadata as needed:
   - Schedule: `webstir add-job nightly --workspace "$PWD" --schedule "0 0 * * *"`
   - Description: `--description "Nightly maintenance window"`
   - Priority: `--priority 5` (accepts numbers or free-form labels)
3. Iterate on the job implementation, then rebuild or watch the workspace.
4. Run jobs locally:
   - List metadata: `bun build/backend/jobs/scheduler.js --list`
   - Export metadata for an external scheduler: `bun build/backend/jobs/scheduler.js --json`
   - Run once: `bun build/backend/jobs/scheduler.js --job nightly`
   - Simple watcher: `bun build/backend/jobs/scheduler.js --watch`
   - Direct execution: `bun build/backend/jobs/<name>/index.js`
5. Inspect the manifest to confirm the job metadata:
   - `webstir backend-inspect --workspace "$PWD"`

## Implement the job
Jobs receive the same environment access and logging helpers as HTTP handlers. The scaffold exports a `run()` function you can extend:

```ts
// src/backend/jobs/cleanup/index.ts
import { createDatabaseClient } from '../../db/connection';

export async function run() {
  const db = await createDatabaseClient();
  const stale = await db.query('select id from sessions where expires_at < datetime("now")');

  if (stale.length > 0) {
    await db.execute('delete from sessions where id in (?)', [stale.map((row) => row.id)]);
    console.info('[jobs] cleaned sessions', { count: stale.length });
  } else {
    console.info('[jobs] no sessions to clean');
  }

  await db.close();
}
```

- `.env` values are loaded automatically; use `process.env.NAME` or the helper exported from the template.
- The scheduler prints job names, schedules, and manifest metadata so you can verify exactly what will run locally, and `--json` emits the same metadata in a machine-friendly format for external schedulers.

## Notes
- The CLI validates `--schedule` strings (`@hourly`, `@daily`, `@weekly`, cron-style fields, `rate(...)`, or `@reboot`) but stores them exactly as provided so your production scheduler can interpret them.
- On Bun `1.3.11+`, the built-in watcher uses `Bun.cron.parse(...)` for real cron expressions and nicknames such as `0 0 * * *`, `*/15 * * * *`, `@daily`, or `@monthly`, while still supporting `rate(...)` and `@reboot` for local development loops. The manifest keeps the original schedule string unchanged, and `--json` gives you a direct export path instead of scraping CLI text.
- Local watch mode skips a run when the same job is still running, and `SIGINT`/`SIGTERM` disposes scheduled timers cleanly. Use an external scheduler or queue when you need durable retry state, distributed locks, or multi-process coordination.
- If a job module is missing or does not export `run()` or a default function, the scheduler fails with a job-specific diagnostic instead of silently skipping it.
- Jobs run through the scheduler automatically load `.env` values, reuse the backend logger, and emit structured logs just like HTTP handlers.
- Use `webstir backend-inspect --workspace "$PWD"` after adding jobs to confirm the manifest entry (name, schedule, description, priority) before committing changes.

## See Also
- CLI reference: `../reference/cli.md#add-job`
- Backend provider: `../explanations/solution.md` (manifest ingestion)
