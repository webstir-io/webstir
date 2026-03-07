import { afterEach, expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';

import { packageRoot, repoRoot } from '../src/paths.ts';

const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];

afterEach(async () => {
  while (childProcesses.length > 0) {
    const child = childProcesses.pop();
    if (!child) {
      continue;
    }

    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
  }
});

test('CLI watch serves the SPA demo and rebuilds after a source edit', async () => {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', 'spa');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-bun-watch-'));
  const workspace = path.join(tempRoot, 'spa');
  await cp(fixtureRoot, workspace, { recursive: true });

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
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  childProcesses.push(child);

  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (!response.ok) {
        throw new Error(`Unexpected status: ${response.status}`);
      }

      const html = await response.text();
      expect(html).toContain('<main>');
      expect(html).toContain('Home');
    }, 20000);

    const sourceHtmlPath = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
    const originalHtml = await readFile(sourceHtmlPath, 'utf8');
    await writeFile(sourceHtmlPath, originalHtml.replace('Home', 'Watched Home'));

    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (!response.ok) {
        throw new Error(`Unexpected status: ${response.status}`);
      }

      const html = await response.text();
      expect(html).toContain('Watched Home');
    }, 20000);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    childProcesses.splice(childProcesses.indexOf(child), 1);
    await rm(tempRoot, { recursive: true, force: true });
  }
}, 30000);

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate a free TCP port.');
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  return port;
}

async function waitFor(
  assertion: () => Promise<void>,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(150);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out after ${timeoutMs}ms.`);
}
