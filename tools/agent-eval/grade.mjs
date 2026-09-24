import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execute, killGroup } from './process.mjs';

const require = createRequire(new URL('../../orchestrators/bun/package.json', import.meta.url));
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function grade({ workspace, cli, task, evidence }) {
  const checks = [];
  const check = async (name, action) => {
    try {
      await action();
      checks.push({ name, passed: true });
      return true;
    } catch (error) {
      checks.push({ name, passed: false, detail: error.message.slice(0, 3000) });
      return false;
    }
  };
  const build = await execute('bun', [cli, 'build', '--workspace', workspace], {
    cwd: workspace,
    timeoutMs: 120000,
    log: path.join(evidence, 'build.log'),
  });
  const built = await check('framework-build', async () => assert.equal(build.code, 0, build.tail));
  if (!built) return { checks };
  const tests = await execute('bun', [cli, 'test', '--workspace', workspace], {
    cwd: workspace,
    timeoutMs: 120000,
    log: path.join(evidence, 'test.log'),
  });
  await check('framework-test', async () => assert.equal(tests.code, 0, tests.tail));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    return { checks, evaluatorError: `Browser unavailable: ${error.message}` };
  }
  let server;
  try {
    server = await startApp(workspace, evidence);
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const authenticated = task !== 'build';
    const origin = server.origin;
    await page.goto(`${origin}/api/notes`);
    if (authenticated) await login(page, 'alice');
    const title = 'Cedar & <draft> note';
    const edited = 'Cedar revised note';
    let id;
    const created = await check('browser-crud', async () => {
      await create(page, title, task === 'extend' ? 'open' : undefined);
      const note = page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      assert.equal(await note.count(), 1, 'Create must render exactly one note');
      id = await note.getAttribute('data-note-id');
      assert.ok(id, 'Each note needs a stable id');
      await page.reload();
      const persisted = page.locator(`article[data-note-id="${id}"]`);
      await persisted.locator('input[name="title"]').fill(edited);
      await Promise.all([
        page.waitForURL('**/api/notes'),
        persisted.getByRole('button', { name: 'Save', exact: true }).click(),
      ]);
      assert.equal(
        await page.getByRole('heading', { name: edited, exact: true }).count(),
        1,
        'Edit must change the stored title',
      );
      await create(page, 'Disposable note', task === 'extend' ? 'open' : undefined);
      const disposable = page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: 'Disposable note', exact: true }) });
      await disposable.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.goto(`${origin}/api/notes`);
      assert.equal(
        await page.getByRole('heading', { name: 'Disposable note', exact: true }).count(),
        0,
        'Delete must remove the note',
      );
    });
    await check('server-validation', async () => {
      assert.ok(created, 'CRUD prerequisite failed');
      for (const route of ['create', 'update']) {
        await page.reload();
        const hidden = await hiddenFields(page, `/api/notes/${route}`);
        const result = await context.request.post(`${origin}/api/notes/${route}`, {
          form: { ...hidden, title: '   ', id, ...(task === 'extend' ? { status: 'open' } : {}) },
          maxRedirects: 0,
        });
        assert.ok(
          result.status() >= 400 && result.status() < 500,
          `Blank ${route} should be rejected, received ${result.status()}`,
        );
      }
      await page.reload();
      assert.equal(await page.getByRole('heading', { name: edited, exact: true }).count(), 1);
      assert.equal(
        await page.locator('article').count(),
        1,
        'Invalid submission must not add a note',
      );
    });
    if (authenticated)
      await check('authorization', async () => {
        assert.ok(created, 'CRUD prerequisite failed');
        const anonymous = await browser.newContext();
        const bobContext = await browser.newContext({ javaScriptEnabled: false });
        try {
          for (const action of ['create', 'update', 'delete']) {
            const response = await anonymous.request.post(`${origin}/api/notes/${action}`, {
              form: { title: 'Intruder', id },
              maxRedirects: 0,
            });
            assert.ok(
              response.status() >= 400 && response.status() < 500,
              `Anonymous ${action} must be rejected`,
            );
          }
          for (const action of ['create', 'update', 'delete']) {
            const missingToken = await context.request.post(`${origin}/api/notes/${action}`, {
              form: { id, title: 'Intruder', status: 'open' },
              maxRedirects: 0,
            });
            assert.equal(missingToken.status(), 403, `${action} must require CSRF`);
          }
          const bob = await bobContext.newPage();
          await bob.goto(`${origin}/api/notes`);
          await login(bob, 'bob');
          assert.equal(
            await bob.locator('article').count(),
            0,
            'Another owner must not see Alice notes',
          );
          for (const action of ['update', 'delete']) {
            await bob.reload();
            const token = await csrf(bob);
            const response = await bobContext.request.post(`${origin}/api/notes/${action}`, {
              form: { id, title: 'Intruder', csrf: token, status: 'open' },
              maxRedirects: 0,
            });
            assert.ok(
              [403, 404].includes(response.status()),
              `Cross-owner ${action} must be rejected`,
            );
          }
          if (task === 'extend') {
            await bob.goto(`${origin}/api/notes?status=all`);
            assert.equal(
              await bob.locator('article').count(),
              0,
              'Filtering must retain ownership',
            );
          }
          await page.reload();
          assert.equal(await page.getByRole('heading', { name: edited, exact: true }).count(), 1);
        } finally {
          await anonymous.close();
          await bobContext.close();
        }
      });
    if (task === 'extend')
      await check('status-filter', async () => {
        assert.ok(created, 'CRUD prerequisite failed');
        const note = page.locator(`article[data-note-id="${id}"]`);
        assert.equal(await note.locator('select[name="status"]').inputValue(), 'open');
        await note.locator('select[name="status"]').selectOption('done');
        await note.getByRole('button', { name: 'Save', exact: true }).click();
        await create(page, 'Still open', 'open');
        const filter = page.locator('form[method="get" i]');
        await filter.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('done');
        await filter.getByRole('button', { name: 'Filter', exact: true }).click();
        assert.equal(await page.getByRole('heading', { name: edited, exact: true }).count(), 1);
        assert.equal(
          await page.getByRole('heading', { name: 'Still open', exact: true }).count(),
          0,
        );
        assert.equal(
          await page.getByRole('combobox', { name: 'Filter', exact: true }).inputValue(),
          'done',
        );
        await page.getByRole('combobox', { name: 'Filter', exact: true }).selectOption('open');
        await page.getByRole('button', { name: 'Filter', exact: true }).click();
        assert.equal(await page.getByRole('heading', { name: edited, exact: true }).count(), 0);
        assert.equal(
          await page.getByRole('heading', { name: 'Still open', exact: true }).count(),
          1,
        );
        for (const action of ['create', 'update']) {
          await page.goto(`${origin}/api/notes?status=all`);
          const hidden = await hiddenFields(page, `/api/notes/${action}`);
          const response = await context.request.post(`${origin}/api/notes/${action}`, {
            form: { ...hidden, id, title: 'Invalid', status: 'unknown' },
            maxRedirects: 0,
          });
          assert.ok(
            response.status() >= 400 && response.status() < 500,
            `Invalid status ${action} must be rejected`,
          );
        }
        await page.goto(`${origin}/api/notes?status=all`);
        assert.equal(
          await page.getByRole('heading', { name: 'Invalid', exact: true }).count(),
          0,
          'Rejected status must not mutate data',
        );
        assert.equal(await page.getByRole('heading', { name: edited, exact: true }).count(), 1);
      });
    if (['repair', 'holdout'].includes(task)) {
      await check('customization', async () => {
        assert.ok(
          (await readFile(path.join(workspace, 'src/frontend/app/app.css'), 'utf8')).includes(
            '--cedar-accent: #315d44;',
          ),
          'Custom CSS was lost',
        );
        assert.equal(
          await page.getByText('Made for the Cedar team.', { exact: true }).count(),
          1,
          'Custom footer was lost',
        );
      });
      await check('managed-file', async () => {
        const fixture = JSON.parse(await readFile(path.join(evidence, 'fixture.json'), 'utf8'));
        const restored = await readFile(path.join(workspace, 'src/frontend/app/hmr.js'));
        assert.equal(
          createHash('sha256').update(restored).digest('hex'),
          fixture.managedFileSha256,
          'Managed file must match the scaffold restoration',
        );
      });
    }
    await check('restart-persistence', async () => {
      assert.ok(created, 'CRUD prerequisite failed');
      await server.stop();
      server = await startApp(workspace, evidence, server.port);
      await page.goto(`${server.origin}/api/notes`);
      if (authenticated) await login(page, 'alice');
      assert.equal(
        await page.getByRole('heading', { name: edited, exact: true }).count(),
        1,
        'Saved note must survive restart',
      );
      assert.equal(
        await page.getByRole('heading', { name: 'Disposable note', exact: true }).count(),
        0,
        'Deleted note must remain deleted after restart',
      );
      if (task === 'extend')
        assert.equal(
          await page.locator(`article[data-note-id="${id}"] select[name="status"]`).inputValue(),
          'done',
        );
      const enabled = await browser.newContext({ javaScriptEnabled: true });
      try {
        await enabled.addCookies(await context.cookies());
        const enhanced = await enabled.newPage();
        await enhanced.goto(`${server.origin}/api/notes`);
        assert.equal(
          await enhanced.getByRole('heading', { name: edited, exact: true }).count(),
          1,
          'HTML must also render with JavaScript enabled',
        );
        await enhanced.screenshot({ path: path.join(evidence, 'result.png'), fullPage: true });
      } finally {
        await enabled.close();
      }
    });
    await context.close();
  } catch (error) {
    checks.push({
      name: 'application-runtime',
      passed: false,
      detail: error.message.slice(0, 3000),
    });
  } finally {
    await server?.stop();
    await browser.close();
  }
  return { checks };
}
async function login(page, owner) {
  await page.locator('input[name="username"]').fill(owner);
  await page.locator('input[name="password"]').fill(`${owner}-password`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText(`Signed in as ${owner}`, { exact: true }).waitFor();
}
async function create(page, title, status) {
  const form = page.locator('form[action="/api/notes/create"]');
  await form.locator('input[name="title"]').fill(title);
  if (status) await form.locator('select[name="status"]').selectOption(status);
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
}
async function hiddenFields(page, action) {
  return page
    .locator(`form[action="${action}"]`)
    .first()
    .locator('input[type="hidden"]')
    .evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => [input.name, input.value])));
}
async function csrf(page) {
  return page.locator('input[name="csrf"]').first().inputValue();
}
async function freePort() {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const { port } = socket.address();
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
export async function startApp(
  workspace,
  evidence,
  preferredPort,
  { readinessTimeoutMs = 10000 } = {},
) {
  const port = preferredPort ?? (await freePort());
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn('bun', ['build/backend/index.js'], {
    cwd: workspace,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      DATA_DIR: path.join(evidence, 'data'),
    },
    stdio: 'ignore',
  });
  let spawnError;
  child.on('error', (error) => {
    spawnError = error;
  });
  const stop = async () => {
    killGroup(child.pid);
    await sleep(100);
    killGroup(child.pid, 'SIGKILL');
  };
  const deadline = Date.now() + readinessTimeoutMs;
  while (Date.now() < deadline) {
    if (spawnError || child.exitCode !== null) break;
    try {
      const response = await fetch(`${origin}/api/notes`, {
        signal: AbortSignal.timeout(Math.min(500, Math.max(1, deadline - Date.now()))),
      });
      if (response.status < 500) return { origin, port, stop };
    } catch {}
    await sleep(100);
  }
  await stop();
  throw new Error(
    `App failed to start: ${spawnError?.message ?? child.exitCode ?? 'readiness timeout'}`,
  );
}
