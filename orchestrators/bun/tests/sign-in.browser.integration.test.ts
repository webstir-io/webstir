import { afterAll, afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, type Browser } from 'playwright';

import { startOidcIssuer } from '../../../packages/tooling/webstir-backend/tests/support/oidcIssuer.js';
import { packageRoot, repoRoot } from '../src/paths.ts';
import { createBatteriesApp } from '../test-support/batteries-app.ts';
import { removeDemoWorkspace, type DemoWorkspaceCopy } from '../test-support/demo-workspace.ts';
import {
  appendWatchLogs,
  collectOutput,
  getFreePort,
  removeTrackedChild,
  stopSpawnedProcess,
  stopTrackedChildren,
  waitFor,
} from '../test-support/watch.ts';

const copies: DemoWorkspaceCopy[] = [];
const children: Array<ReturnType<typeof Bun.spawn>> = [];
let browser: Browser | undefined;

afterEach(async () => {
  await stopTrackedChildren(children);
  await Promise.all(copies.splice(0).map((copy) => removeDemoWorkspace(copy)));
});
afterAll(async () => {
  await browser?.close();
});

/** The sign-in emails `webstir watch` kept in .webstir/email.log, oldest first. */
async function devEmails(workspace: string): Promise<{ to: string; text: string }[]> {
  try {
    const log = await readFile(path.join(workspace, '.webstir', 'email.log'), 'utf8');
    return log
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test('in watch, a visitor signs in with the emailed code or link, and a scheduled job runs', async () => {
  const workspace = await createBatteriesApp(copies);
  const port = await getFreePort();
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'watch',
      '--workspace',
      workspace,
      '--port',
      String(port),
    ],
    cwd: repoRoot,
    env: { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  children.push(child);
  const stdout = { text: '' };
  const stderr = { text: '' };
  void collectOutput(child.stdout, stdout);
  void collectOutput(child.stderr, stderr);
  const origin = `http://127.0.0.1:${port}`;

  try {
    await waitFor(async () => {
      expect(stdout.text).toContain('[webstir] watch starting');
      expect((await fetch(`${origin}/sign-in/`)).status).toBe(200);
    }, 60_000);

    browser ??= await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // A signed-out visitor to the notes page is sent to sign in.
    await page.goto(`${origin}/notes/`);
    await page.waitForURL(/\/sign-in\/\?returnTo=%2Fnotes%2F/);
    await page.fill('#email', 'ada@example.com');
    await page.click('text=Send me a code');
    await page.waitForSelector('text=a code is on its way');
    await page.waitForSelector('text=In development the email is not sent');

    await waitFor(async () => expect(await devEmails(workspace)).toHaveLength(1), 10_000);
    const [mail] = await devEmails(workspace);
    expect(mail?.to).toBe('ada@example.com');
    const code = /code is (\d{6})/.exec(mail?.text ?? '')?.[1] ?? '';
    await page.fill('#code', code);
    await page.click('form:has(#code) button');
    await page.waitForURL(`${origin}/notes/`, { waitUntil: 'commit' });
    await page.waitForSelector('.who:text("ada@example.com")');

    // The job scheduled every second runs in watch, and the form writes through the batteries.
    await page.fill('input[name="body"]', 'from-the-browser');
    await page.click('text=Add');
    await waitFor(async () => {
      await page.reload();
      const items = await page.locator('li').allTextContents();
      expect(items).toContain('from-the-browser');
      expect(items).toContain('job:from-the-browser');
      expect(items).toContain('tick');
    }, 20_000);

    // The emailed link, opened in another browser, points at the address the visitor used.
    const other = await browser.newContext();
    const second = await other.newPage();
    await second.goto(`${origin}/sign-in/`);
    await second.fill('#email', 'grace@example.com');
    await second.click('text=Send me a code');
    await waitFor(async () => expect(await devEmails(workspace)).toHaveLength(2), 10_000);
    const link =
      /(https?:\/\/\S+\/sign-in\/confirm\/\S+)/.exec(
        (await devEmails(workspace))[1]?.text ?? '',
      )?.[1] ?? '';
    expect(new URL(link).origin).toBe(origin);
    await second.goto(link);
    await second.click('button:has-text("Sign in")');
    // Client-nav shows the next page without a load event.
    await second.waitForURL(`${origin}/`, { waitUntil: 'commit' });
    await second.goto(`${origin}/notes/`);
    await second.waitForSelector('.who:text("grace@example.com")');
    await other.close();

    expect(errors).toEqual([]);
    await context.close();
  } catch (error) {
    throw appendWatchLogs(error, stdout.text, stderr.text);
  } finally {
    // Stopping watch can take longer than a hook's limit, so it happens within the test.
    removeTrackedChild(children, child);
    await stopSpawnedProcess(child);
  }
}, 180_000);

const OIDC_SIGN_IN = `import { oidc, type SignInOptions } from '@webstir-io/webstir-backend/sign-in';

const signIn: SignInOptions = {
  providers: [
    oidc({
      id: 'acme',
      label: 'Acme',
      issuer: process.env.ACME_ISSUER,
      clientId: process.env.ACME_CLIENT_ID,
      clientSecret: process.env.ACME_CLIENT_SECRET,
    }),
  ],
};

export default signIn;
`;

test('in watch, a visitor signs in through an OpenID Connect provider set up in .env', async () => {
  const issuer = await startOidcIssuer();
  const workspace = await createBatteriesApp(copies);
  await writeFile(path.join(workspace, 'src', 'backend', 'sign-in.ts'), OIDC_SIGN_IN, 'utf8');
  await writeFile(
    path.join(workspace, '.env'),
    `ACME_ISSUER=${issuer.url}\nACME_CLIENT_ID=${issuer.clientId}\nACME_CLIENT_SECRET=${issuer.clientSecret}\n`,
    'utf8',
  );
  const port = await getFreePort();
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'watch',
      '--workspace',
      workspace,
      '--port',
      String(port),
    ],
    cwd: repoRoot,
    env: { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  children.push(child);
  const stdout = { text: '' };
  const stderr = { text: '' };
  void collectOutput(child.stdout, stdout);
  void collectOutput(child.stderr, stderr);
  const origin = `http://127.0.0.1:${port}`;

  try {
    await waitFor(async () => {
      expect(stdout.text).toContain('[webstir] watch starting');
      expect((await fetch(`${origin}/sign-in/`)).status).toBe(200);
    }, 60_000);

    browser ??= await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // The page offers the provider beside the emailed code, and the provider sends them back.
    await page.goto(`${origin}/notes/`);
    await page.waitForURL(/\/sign-in\/\?returnTo=%2Fnotes%2F/);
    await page.waitForSelector('text=Send me a code');
    await page.click('a:has-text("Sign in with Acme")');
    await page.waitForURL(`${origin}/notes/`);
    await page.waitForSelector('.who:text("ada@example.com")');
    expect(issuer.tokenRequests).toHaveLength(1);
    expect(issuer.tokenRequests[0].redirect_uri).toBe(`${origin}/sign-in/acme/callback/`);

    // Turned away at the provider, a visitor is back at sign-in, told so, and still signed out.
    issuer.deny = true;
    const other = await browser.newContext();
    const second = await other.newPage();
    await second.goto(`${origin}/sign-in/`);
    await second.click('a:has-text("Sign in with Acme")');
    await second.waitForURL(`${origin}/sign-in/`);
    await second.waitForSelector('text=Signing in with Acme did not finish. Try again.');
    await second.goto(`${origin}/notes/`);
    await second.waitForURL(/\/sign-in\/\?returnTo=%2Fnotes%2F/);
    await other.close();

    expect(errors).toEqual([]);
    await context.close();
  } catch (error) {
    throw appendWatchLogs(error, stdout.text, stderr.text);
  } finally {
    removeTrackedChild(children, child);
    await stopSpawnedProcess(child);
    issuer.stop();
  }
}, 180_000);
