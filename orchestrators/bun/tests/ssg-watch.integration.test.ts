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

test('CLI watch serves the SSG demo and rebuilds generated content after a markdown edit', async () => {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', 'ssg', 'base');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-bun-ssg-watch-'));
  const workspace = path.join(tempRoot, 'ssg-base');
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
      expect(await fetchText(port, '/')).toContain('Welcome to your Webstir site');
      expect(await fetchText(port, '/docs/hosting')).toContain('Deploying your site');
    }, 20_000);

    const contentPath = path.join(workspace, 'src', 'frontend', 'content', 'hosting.md');
    const originalContent = await readFile(contentPath, 'utf8');
    await writeFile(contentPath, originalContent.replace('Deploying your site', 'Hosting guide updated'), 'utf8');

    await waitFor(async () => {
      expect(await fetchText(port, '/docs/hosting')).toContain('Hosting guide updated');
    }, 20_000);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    const childIndex = childProcesses.indexOf(child);
    if (childIndex >= 0) {
      childProcesses.splice(childIndex, 1);
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}, 45_000);

async function fetchText(port: number, requestPath: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}${requestPath}`);
  if (!response.ok) {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return await response.text();
}

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
