import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';

import { runWebstir } from '../test-support/cli.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

const env = { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' };

test('a new server app keeps its settings example, and git leaves out its data and secrets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-init-batteries-'));
  try {
    for (const starter of ['full', 'api', 'spa']) {
      const app = path.join(root, starter);
      const result = await runWebstir(['init', starter, app], { env });
      expect(result.exitCode).toBe(0);
      const server = starter !== 'spa';
      expect({ starter, env: existsSync(path.join(app, '.env.example')) }).toEqual({
        starter,
        env: server,
      });
      if (!server) continue;
      const gitignore = await readFile(path.join(app, '.gitignore'), 'utf8');
      for (const line of ['data/', '.webstir/', '.env', '.env.local'])
        expect(gitignore).toContain(line);
      expect(await readFile(path.join(app, 'src', 'backend', 'index.ts'), 'utf8')).toContain(
        'createDefaultBunBackendBootstrap({ importMetaUrl: import.meta.url })',
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('enable backend adds the lines a .gitignore lacks, and keeps the rest', async () => {
  const copy = await copyDemoWorkspace('spa', 'webstir-enable-backend-gitignore-');
  try {
    const root = copy.workspaceRoot;
    await writeFile(path.join(root, '.gitignore'), 'node_modules/\nmy-notes.txt\n');
    const result = await runWebstir(['enable', 'backend', '--workspace', root], { env });
    expect(result.exitCode).toBe(0);
    const lines = (await readFile(path.join(root, '.gitignore'), 'utf8')).trim().split('\n');
    expect(lines.filter((line) => line === 'node_modules/')).toHaveLength(1);
    expect(lines).toContain('my-notes.txt');
    expect(lines).toContain('data/');
    expect(existsSync(path.join(root, '.env.example'))).toBe(true);
  } finally {
    await removeDemoWorkspace(copy);
  }
});

test('enable sign-in writes its choices and pages once, in an app with pages and a server', async () => {
  const full = await copyDemoWorkspace('full', 'webstir-enable-sign-in-');
  const spa = await copyDemoWorkspace('spa', 'webstir-enable-sign-in-spa-');
  const api = await copyDemoWorkspace('api', 'webstir-enable-sign-in-api-');
  try {
    const enabled = await runWebstir(['enable', 'sign-in', '--workspace', full.workspaceRoot], {
      env,
    });
    expect(enabled.exitCode).toBe(0);
    for (const file of [
      'src/backend/sign-in.ts',
      'src/frontend/pages/sign-in/index.html',
      'src/frontend/pages/sign-in-confirm/index.html',
    ]) {
      expect(existsSync(path.join(full.workspaceRoot, file))).toBe(true);
    }
    for (const [workspace, message] of [
      [full.workspaceRoot, 'Sign-in is already set up'],
      [spa.workspaceRoot, 'Sign-in needs pages and a server'],
      [api.workspaceRoot, 'Sign-in needs pages and a server'],
    ] as const) {
      const refused = await runWebstir(['enable', 'sign-in', '--workspace', workspace], { env });
      expect({ workspace, exitCode: refused.exitCode }).toEqual({ workspace, exitCode: 1 });
      expect(refused.stderr).toContain(message);
    }
  } finally {
    await Promise.all([full, spa, api].map((copy) => removeDemoWorkspace(copy)));
  }
});

test('add-migration numbers migrations, and migrate applies them and lists them', async () => {
  const copy = await copyDemoWorkspace('full', 'webstir-migrate-');
  try {
    const root = copy.workspaceRoot;
    const add = (...args: string[]) =>
      runWebstir(['add-migration', ...args, '--workspace', root], { env });
    expect((await add('create-notes')).exitCode).toBe(0);
    expect((await add('seed-notes', '--ts')).exitCode).toBe(0);
    const migrations = path.join(root, 'src', 'backend', 'migrations');
    expect(await readdir(migrations)).toEqual(['0001-create-notes.sql', '0002-seed-notes.ts']);
    const duplicate = await add('create-notes');
    expect(duplicate.exitCode).toBe(1);
    expect(duplicate.stderr).toContain('Migration "create-notes" already exists');

    await writeFile(
      path.join(migrations, '0001-create-notes.sql'),
      'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);\n',
    );
    await writeFile(
      path.join(migrations, '0002-seed-notes.ts'),
      "import type { Database } from '@webstir-io/webstir-backend/db';\nexport async function up(db: Database) {\n  await db.execute('INSERT INTO notes (body) VALUES (?)', ['first']);\n}\n",
    );

    const pending = await runWebstir(['migrate', '--status', '--workspace', root], { env });
    expect(pending.exitCode).toBe(0);
    expect(pending.stdout).toContain('pending  src/backend/migrations/0001-create-notes.sql');
    expect(pending.stdout).toContain('pending  src/backend/migrations/0002-seed-notes.ts');

    const applied = await runWebstir(['migrate', '--workspace', root], { env });
    expect(applied.exitCode).toBe(0);
    expect(applied.stdout).toContain('[webstir] applied\n  0001-create-notes\n  0002-seed-notes');
    expect((await runWebstir(['migrate', '--workspace', root], { env })).stdout).toContain(
      'migrations are up to date',
    );
    const status = await runWebstir(['migrate', '--status', '--workspace', root], { env });
    expect(status.stdout).toMatch(/applied \S+ {2}src\/backend\/migrations\/0002-seed-notes\.ts/);

    const unknown = await runWebstir(['migrate', '--down', '--workspace', root], { env });
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain('Unknown option "--down"');
  } finally {
    await removeDemoWorkspace(copy);
  }
}, 120_000);

test("webstir jobs lists an app's jobs and runs one now", async () => {
  const copy = await copyDemoWorkspace('full', 'webstir-jobs-');
  try {
    const root = copy.workspaceRoot;
    const job = path.join(root, 'src', 'backend', 'jobs', 'hello');
    await Bun.write(
      path.join(job, 'index.ts'),
      "import { writeFileSync } from 'node:fs';\nexport async function run(payload: { name: string }) {\n  writeFileSync('ran.txt', `hello ${payload.name}`);\n}\n",
    );
    const listed = await runWebstir(['jobs', '--workspace', root], { env });
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain('[webstir] jobs\n  hello');
    expect(listed.stdout).toContain('queue: 0 queued, 0 running, 0 done, 0 failed');

    const ran = await runWebstir(
      ['jobs', 'run', 'hello', '--payload', '{"name":"Ada"}', '--workspace', root],
      {
        env,
        cwd: root,
      },
    );
    expect(ran.exitCode).toBe(0);
    expect(await readFile(path.join(root, 'ran.txt'), 'utf8')).toBe('hello Ada');

    const missing = await runWebstir(['jobs', 'run', 'nope', '--workspace', root], { env });
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('there is no job "nope"');
  } finally {
    await removeDemoWorkspace(copy);
  }
}, 120_000);
