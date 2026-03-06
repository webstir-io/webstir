# Add a Backend Job

Scaffold a job stub and record it in the module manifest.

## Prerequisites
- A Webstir workspace initialized via `webstir init ...`.
- Backend source at `src/backend/`.

## Steps
1. Create a job named `cleanup`:
   - `webstir add-job cleanup`
   - Creates `src/backend/jobs/cleanup/index.ts` with a `run()` function.
   - Adds `{ name: "cleanup" }` to `webstir.moduleManifest.jobs` in `package.json`.
2. Add metadata as needed:
   - Schedule: `webstir add-job nightly --schedule "0 0 * * *"`
   - Description: `--description "Nightly maintenance window"`
   - Priority: `--priority 5` (accepts numbers or free-form labels)
3. Iterate on the job implementation (see below) and rebuild/watch with `--runtime backend`.
4. Run jobs locally:
   - List metadata: `node build/backend/jobs/scheduler.js --list`
   - Run once: `node build/backend/jobs/scheduler.js --job nightly`
   - Simple watcher: `node build/backend/jobs/scheduler.js --watch`
   - Direct execution: `node build/backend/jobs/<name>/index.js`
5. Inspect the manifest to confirm the job metadata:
   - `webstir backend-inspect`

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
- The scheduler prints job names, schedules, and manifest metadata so you can verify exactly what will run in CI or production.

## Notes
- The CLI validates `--schedule` strings (`@hourly`, `@daily`, or cron-style fields) but stores them exactly as provided so your production scheduler can interpret them.
- The built-in watcher understands `@hourly`, `@daily`, `@weekly`, `@reboot`, and `rate(n unit)` syntax. Cron expressions are surfaced in the manifest so you can wire them into Temporal, Cloud Scheduler, etc.
- Jobs run through the scheduler automatically load `.env` values, reuse the backend logger, and emit structured logs just like HTTP handlers.
- Use `webstir backend-inspect` after adding jobs to confirm the manifest entry (name, schedule, description, priority) before committing changes.

## See Also
- CLI reference: `../reference/cli.md#add-job`
- Backend provider: `../explanations/solution.md` (manifest ingestion)
