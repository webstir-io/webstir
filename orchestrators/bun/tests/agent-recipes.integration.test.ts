import { afterAll, beforeAll, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';

import { packageRoot } from '../src/paths.ts';

const recipeRoot = path.join(packageRoot, 'resources/guides/recipes');
const dependencies = path.join(packageRoot, 'node_modules');
let workspace: string;
let origin: string;
let server: ReturnType<typeof Bun.spawn>;
let browser: Browser;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), 'webstir-recipes-'));
  await mkdir(path.join(workspace, 'src/backend'), { recursive: true });
  await symlink(dependencies, path.join(workspace, 'node_modules'));
  await cp(path.join(recipeRoot, 'notes/notes.ts'), path.join(workspace, 'src/backend/notes.ts'));
  await cp(
    path.join(recipeRoot, 'projects/projects.ts'),
    path.join(workspace, 'src/backend/projects.ts'),
  );
  const guide = await readFile(path.join(recipeRoot, 'notes/README.md'), 'utf8');
  const databaseSource = guide.match(/```ts\n([\s\S]+?)```/)?.[1];
  if (!databaseSource) throw new Error('Expected the cookbook database module.');
  await writeFile(path.join(workspace, 'src/backend/database.ts'), databaseSource);
  await writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ type: 'module', webstir: { mode: 'api' } }),
  );
  await writeFile(
    path.join(workspace, 'src/backend/module.ts'),
    `
    import { getDatabase } from './database.ts';
    import { createNotesRoutes } from './notes.ts';
    import { createProjectRoutes } from './projects.ts';
    let seeded = false;
    function getSeededDatabase() {
    const db = getDatabase();
    if (!seeded) {
    db.exec("CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL)");
    db.query('INSERT OR IGNORE INTO projects (id, owner_id, title) VALUES (?, ?, ?)').run('existing', 'alpha', 'Before migration');
    db.query('INSERT OR IGNORE INTO projects (id, owner_id, title) VALUES (?, ?, ?)').run('private', 'beta', 'Other owner');
    seeded = true;
    }
    return db;
    }
    const routes = [...createNotesRoutes(getSeededDatabase), ...createProjectRoutes(getSeededDatabase)];
    export const module = { manifest: { contractVersion: '1.0.0', name: '@recipe/test', version: '1.0.0', kind: 'backend', capabilities: ['http'], routes: routes.map(route => route.definition) }, routes };
  `,
  );
  await writeFile(
    path.join(workspace, 'src/backend/index.ts'),
    `
    import { createDefaultBunBackendBootstrap, startBunBackend } from '@webstir-io/webstir-backend';
    await startBunBackend(createDefaultBunBackendBootstrap({
      importMetaUrl: import.meta.url,
      loadEnv: () => ({ NODE_ENV: 'test', PORT: Number(process.env.PORT), auth: {}, metrics: {}, http: { bodyLimitBytes: 1048576 }, sessions: { secret: 'recipe-proof-only-session-secret', cookieName: 'recipe_session', secure: false, maxAgeSeconds: 3600, path: '/', sameSite: 'Lax' } }),
      // Test-only principal adapter; never shipped as application auth.
      resolveRequestAuth: async request => {
        const bearer = request.headers.get('authorization');
        return bearer === 'Bearer alpha' ? { userId: 'alpha' } : bearer === 'Bearer beta' ? { userId: 'beta' } : undefined;
      },
    }));
  `,
  );
  origin = `http://127.0.0.1:${await freePort()}`;
  await start();
  browser = await chromium.launch({ headless: true });
}, 20000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
  if (server) await server.exited;
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

test('build and inspect leave storage untouched; requests use the app-root database', async () => {
  const caller = await mkdtemp(path.join(os.tmpdir(), 'webstir-recipe-caller-'));
  const configured = path.join(caller, 'explicit.sqlite');
  const defaultDatabase = path.join(workspace, 'data/app.sqlite');
  try {
    for (const command of ['build', 'backend-inspect']) {
      const result = Bun.spawnSync({
        cmd: [
          process.execPath,
          path.join(packageRoot, 'src/cli.ts'),
          command,
          '--workspace',
          workspace,
        ],
        cwd: caller,
        // This proof covers module-import side effects; the recipe types are checked
        // in the generated consumer app with @types/bun installed.
        env: {
          ...runtimeEnv(),
          WEBSTIR_BACKEND_TYPECHECK: 'skip',
          ...(command === 'build' ? { APP_DATABASE_PATH: configured } : {}),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(new TextDecoder().decode(result.stderr)).toBe('');
      expect(result.exitCode).toBe(0);
      expect(existsSync(configured)).toBe(false);
      expect(existsSync(defaultDatabase)).toBe(false);
    }
    expect((await fetch(`${origin}/api/projects`)).status).toBe(401);
    expect(existsSync(defaultDatabase)).toBe(false);
    expect((await fetch(`${origin}/api/notes`)).status).toBe(200);
    expect(existsSync(defaultDatabase)).toBe(true);
    expect(existsSync(path.join(caller, 'data/app.sqlite'))).toBe(false);
    server.kill();
    await server.exited;
    await start(configured, caller);
    expect(existsSync(configured)).toBe(false);
    expect((await fetch(`${origin}/api/notes`)).status).toBe(200);
    expect(existsSync(configured)).toBe(true);
    server.kill();
    await server.exited;
    await start(undefined, caller);
    expect((await fetch(`${origin}/api/notes`)).status).toBe(200);
    expect(existsSync(path.join(caller, 'data/app.sqlite'))).toBe(false);
  } finally {
    await rm(caller, { recursive: true, force: true });
  }
}, 20000);

test('notes work without JavaScript, validate, escape, persist across restart, and delete', async () => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/api/notes`);
    const unsafe = '<img src=x onerror=alert(1)>';
    const token = await page.locator('input[name="_csrf"]').inputValue();
    const invalid = await context.request.post(`${origin}/api/notes`, {
      form: { _csrf: token, title: ' ', body: 'Keep my draft' },
    });
    expect(invalid.status()).toBe(422);
    expect(await invalid.text()).toContain('Keep my draft');
    await page.reload();
    await page.getByLabel('Title').fill(unsafe);
    await page.getByLabel('Body').fill('Original body');
    await clickAndNavigate(page, 'Create note');
    expect(await page.locator('article').textContent()).toContain(unsafe);
    expect(await page.locator('img').count()).toBe(0);
    await page.getByRole('link', { name: `Edit ${unsafe}`, exact: true }).click();
    await page.getByLabel('Title').fill('Saved note');
    await page.getByLabel('Body').fill(unsafe);
    await clickAndNavigate(page, 'Save note');
    expect(await page.locator('article').textContent()).toContain(unsafe);
    const noteId = await page.locator('article').getAttribute('data-note-id');
    const forbidden = await context.request.post(`${origin}/api/notes/${noteId}/delete`, {
      form: { _csrf: 'bad' },
    });
    expect(forbidden.status()).toBe(403);
    server.kill();
    await server.exited;
    await start();
    await page.reload();
    expect(await page.locator('article').textContent()).toContain('Saved note');
    await page.getByRole('link', { name: 'Edit Saved note', exact: true }).click();
    await clickAndNavigate(page, 'Delete note');
    expect(await page.locator('article').count()).toBe(0);
    expect((await context.request.post(`${origin}/api/notes/missing`, { form: {} })).status()).toBe(
      404,
    );
  } finally {
    await context.close();
  }
}, 20000);

test('projects preserve migration data, filter natively, reject invalid writes and isolate owners', async () => {
  const alpha = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: { authorization: 'Bearer alpha' },
  });
  const beta = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: { authorization: 'Bearer beta' },
  });
  const anonymous = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await alpha.newPage();
    await page.goto(`${origin}/api/projects`);
    const existing = page.locator('[data-project-id="existing"]');
    expect(await existing.getByLabel('Title').inputValue()).toBe('Before migration');
    expect(await existing.getByLabel('Status').inputValue()).toBe('active');
    expect(await page.getByText('Other owner', { exact: true }).count()).toBe(0);
    const invalid = await alpha.request.post(`${origin}/api/projects/existing`, {
      form: {
        _csrf: await existing.locator('input[name="_csrf"]').first().inputValue(),
        title: 'Changed',
        status: 'invalid',
      },
    });
    expect(invalid.status()).toBe(422);
    expect(await invalid.text()).toContain('Choose active or archived.');
    await page.reload();
    await existing.getByLabel('Status').selectOption('archived');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      existing.getByRole('button', { name: 'Save project' }).click(),
    ]);
    const filter = page.locator('form[method="get"]');
    await filter.getByLabel('Status').selectOption('archived');
    await clickAndNavigate(page, 'Filter');
    expect(page.url()).toBe(`${origin}/api/projects?status=archived`);
    expect(await existing.count()).toBe(1);
    await filter.getByLabel('Status').selectOption('active');
    await clickAndNavigate(page, 'Filter');
    expect(await existing.count()).toBe(0);
    expect(await page.getByText('No projects match this filter.', { exact: true }).count()).toBe(1);
    expect((await alpha.request.get(`${origin}/api/projects?status=unknown`)).status()).toBe(400);
    const betaPage = await beta.newPage();
    await betaPage.goto(`${origin}/api/projects`);
    const betaToken = await betaPage
      .locator('form[action="/api/projects"] input[name="_csrf"]')
      .inputValue();
    expect(await betaPage.getByText('Before migration', { exact: true }).count()).toBe(0);
    for (const suffix of ['', '/delete']) {
      const denied = await beta.request.post(`${origin}/api/projects/existing${suffix}`, {
        form: { _csrf: betaToken, title: 'Stolen', status: 'active', owner_id: 'alpha' },
      });
      expect(denied.status()).toBe(404);
    }
    expect((await anonymous.request.get(`${origin}/api/projects`)).status()).toBe(401);
    expect(
      (
        await anonymous.request.post(`${origin}/api/projects`, {
          form: { title: 'Anonymous', status: 'active' },
        })
      ).status(),
    ).toBe(401);
    const forgedOwner = await beta.request.post(`${origin}/api/projects`, {
      form: {
        _csrf: betaToken,
        title: '<img src=x onerror=alert(1)>',
        status: 'archived',
        owner_id: 'alpha',
      },
      maxRedirects: 0,
    });
    expect(forgedOwner.status()).toBe(303);
    await betaPage.goto(`${origin}/api/projects?status=archived`);
    expect(await betaPage.locator('article').count()).toBe(1);
    expect(await betaPage.locator('article h2').textContent()).toBe('<img src=x onerror=alert(1)>');
    expect(await betaPage.locator('img').count()).toBe(0);
    const betaId = await betaPage.locator('article').getAttribute('data-project-id');
    await clickAndNavigate(betaPage, 'Delete <img src=x onerror=alert(1)>');
    expect(await betaPage.locator(`[data-project-id="${betaId}"]`).count()).toBe(0);
    const persisted = await alpha.request.get(`${origin}/api/projects?status=archived`);
    expect(await persisted.text()).toContain('Before migration');
    const csrf = await alpha.request.post(`${origin}/api/projects/existing`, {
      form: { _csrf: 'bad', title: 'Blocked', status: 'active' },
    });
    expect(csrf.status()).toBe(403);
    server.kill();
    await server.exited;
    await start();
    const afterRestart = await alpha.request.get(`${origin}/api/projects?status=archived`);
    expect(await afterRestart.text()).toContain('Before migration');
  } finally {
    await Promise.all([alpha.close(), beta.close(), anonymous.close()]);
  }
}, 20000);

async function clickAndNavigate(page: Page, name: string) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.getByRole('button', { name, exact: true }).click(),
  ]);
}

function runtimeEnv() {
  const env = { ...process.env };
  delete env.APP_DATABASE_PATH;
  return env;
}

async function start(databasePath?: string, cwd = workspace) {
  server = Bun.spawn([process.execPath, path.join(workspace, 'src/backend/index.ts')], {
    cwd,
    env: {
      ...runtimeEnv(),
      PORT: new URL(origin).port,
      ...(databasePath ? { APP_DATABASE_PATH: databasePath } : {}),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${origin}/healthz`)).ok) return;
    } catch {}
    if (server.exitCode !== null) throw new Error(await new Response(server.stderr).text());
    await Bun.sleep(50);
  }
  throw new Error('Recipe backend did not become ready.');
}

async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  return port;
}
