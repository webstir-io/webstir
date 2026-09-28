# Run Jobs

A job is a file: `src/backend/jobs/<name>/index.ts`, exporting `run(payload, context)`. The server runs it on a schedule, or later from a queue with retries. Both run inside the server process, in `watch` and in production.

```bash
webstir add-job nightly --workspace "$PWD" --schedule "0 3 * * *"
```

```ts
import { db } from '@webstir-io/webstir-backend/db';

export async function run(): Promise<void> {
  await db.execute('DELETE FROM audit_log WHERE created_at < ?', [new Date(Date.now() - 30 * 86_400_000)]);
}
```

## On a schedule

`add-job --schedule` records the schedule in `package.json` (`webstir.moduleManifest.jobs`). A schedule is:

- a cron expression: `0 3 * * *`, `*/15 * * * *`
- a nickname: `@daily`, `@hourly`, `@monthly`
- `@reboot`: once, when the server starts
- `rate(5 minutes)`, `rate(1 hour)`

A run still going when the next is due is skipped, not overlapped.

## Later, with retries

Queue a job from a handler, a view loader or another job:

```ts
await ctx.jobs.enqueue('send-invoice', { invoiceId }, { delaySeconds: 60, maxAttempts: 5 });
```

```ts
// src/backend/jobs/send-invoice/index.ts
export async function run(payload: { invoiceId: string }, context: { attempt: number }) {
  // ...
}
```

- The queue lives in the app's database, so queued jobs survive a restart.
- A job that throws runs again after 30 seconds, then 1, 2, 4 minutes and so on (at most an hour), until `maxAttempts` (default 5). Then it is kept as failed, with its error.
- Jobs run one at a time, at least once each: make them safe to run twice.
- Outside a handler: `import { jobs } from '@webstir-io/webstir-backend/jobs'`.

## See and run them

```bash
webstir jobs --workspace "$PWD"                                   # jobs, schedules, the queue, failures
webstir jobs run send-invoice --payload '{"invoiceId":"42"}' --workspace "$PWD"
```

## One machine

Jobs run in the server process on one machine. With several servers, set `WEBSTIR_JOBS=off` on all but one, so only it runs jobs. A server that starts puts back in the queue any job left running, so during a rolling deploy a job the old server is still running can run again; that is one more reason to make jobs safe to run twice.
