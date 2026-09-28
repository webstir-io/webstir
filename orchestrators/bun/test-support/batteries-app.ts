import { expect } from 'bun:test';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { runEnable } from '../src/enable.ts';
import type { DemoWorkspaceCopy } from './demo-workspace.ts';
import { copyFullWorkspace } from './render-workspace.ts';

const NOTES_MODULE = `import { z } from 'zod';
import { processFormSubmission } from '@webstir-io/webstir-backend/runtime/forms';

const notesView = {
  definition: { name: 'notes', path: '/notes', page: 'notes', auth: 'required' as const },
  data: z.object({ email: z.string(), notes: z.array(z.string()) }),
  load: async (ctx: any) => ({
    email: ctx.user.email,
    notes: (await ctx.db.query('SELECT body FROM notes ORDER BY body')).map((row: any) => row.body),
  }),
};

const formRoute = (name: string, path: string) => ({
  name,
  method: 'POST' as const,
  path,
  interaction: 'navigation' as const,
  auth: 'required' as const,
  session: { mode: 'optional' as const, write: true },
  form: { contentType: 'application/x-www-form-urlencoded' as const, csrf: true },
});

const addNote = {
  definition: formRoute('addNote', '/notes'),
  handler: async (ctx: any) => {
    const submitted = processFormSubmission({ session: ctx.session, body: ctx.body, formId: 'notes', csrf: true, redirectTo: '/notes/' });
    ctx.session = submitted.session;
    if (!submitted.ok) return submitted.result;
    const body = String(submitted.values.body);
    await ctx.db.execute('INSERT INTO notes (id, body) VALUES (?, ?)', [crypto.randomUUID(), body]);
    await ctx.jobs.enqueue('remember', { body });
    await ctx.jobs.enqueue('broken', undefined, { maxAttempts: 1 });
    await ctx.files.put('notes/' + body + '.txt', body);
    return { status: 303, redirect: { location: '/notes/' } };
  },
};

const me = {
  definition: { name: 'me', method: 'GET' as const, path: '/api/me', auth: 'required' as const },
  handler: (ctx: any) => ({ body: { email: ctx.user.email } }),
};
`;

/**
 * A copy of the full demo with the batteries in use: sign-in, a migration, a notes page only a
 * signed-in user sees, a form that writes to the database, queues jobs and stores a file, an API
 * route, and a job that runs every second.
 */
export async function createBatteriesApp(copies: DemoWorkspaceCopy[]): Promise<string> {
  const workspace = await copyFullWorkspace(copies);
  await runEnable({ workspaceRoot: workspace, args: ['sign-in'] });
  const backend = path.join(workspace, 'src', 'backend');
  const write = async (file: string, contents: string) => {
    await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
    await writeFile(path.join(workspace, file), contents, 'utf8');
  };
  await write(
    'src/backend/migrations/0001-notes.sql',
    'CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL);\n',
  );
  await write(
    'src/backend/jobs/remember/index.ts',
    `import { db } from '@webstir-io/webstir-backend/db';\nexport async function run(payload: { body: string }) {\n  await db.execute('INSERT INTO notes (id, body) VALUES (?, ?)', [crypto.randomUUID(), 'job:' + payload.body]);\n}\n`,
  );
  await write(
    'src/backend/jobs/tick/index.ts',
    `import { db } from '@webstir-io/webstir-backend/db';\nexport async function run() {\n  await db.execute("INSERT INTO notes (id, body) VALUES ('tick', 'tick') ON CONFLICT (id) DO NOTHING");\n}\n`,
  );
  await write(
    'src/backend/jobs/broken/index.ts',
    `export async function run() {\n  throw new Error('broken on purpose');\n}\n`,
  );
  await write(
    'src/frontend/pages/notes/index.html',
    [
      '<head><title>Notes</title></head>',
      '<body><main>',
      '  <p class="who" data-text="email"></p>',
      '  <ul><li data-each="notes as note" data-text="note"></li></ul>',
      '  <form method="post" action="/notes/"><input name="body" /><button type="submit">Add</button></form>',
      '</main></body>',
      '',
    ].join('\n'),
  );
  const modulePath = path.join(backend, 'module.ts');
  const original = await readFile(modulePath, 'utf8');
  const updated = `${NOTES_MODULE}\n${original}`.replace(
    '  routes,\n};',
    '  routes: [...routes, addNote, me],\n  views: [notesView],\n};',
  );
  expect(updated).toContain('views: [notesView]');
  await writeFile(modulePath, updated, 'utf8');
  const packagePath = path.join(workspace, 'package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.webstir.moduleManifest = { jobs: [{ name: 'tick', schedule: 'rate(1 seconds)' }] };
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return workspace;
}
