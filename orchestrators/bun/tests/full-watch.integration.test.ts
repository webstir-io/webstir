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

test('CLI watch serves the full demo, proxies /api, and rebuilds frontend and backend changes', async () => {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', 'full');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-full-watch-'));
  const workspace = path.join(tempRoot, 'full');
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
    env: {
      ...process.env,
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  childProcesses.push(child);
  const stdoutBuffer = { text: '' };
  const stderrBuffer = { text: '' };
  const stdoutDrain = collectOutput(child.stdout, stdoutBuffer);
  const stderrDrain = collectOutput(child.stderr, stderrBuffer);

  try {
    await waitFor(async () => {
      expect(await fetchText(port, '/')).toContain('Home');
      expect(await fetchText(port, '/api')).toContain('API server running');
    }, 20_000);

    const frontendPath = path.join(workspace, 'src', 'frontend', 'pages', 'home', 'index.html');
    const originalFrontend = await readFile(frontendPath, 'utf8');
    await writeFile(frontendPath, originalFrontend.replace('Home', 'Full Home'), 'utf8');

    await waitFor(async () => {
      expect(await fetchText(port, '/')).toContain('Full Home');
    }, 20_000);

    const backendPath = path.join(workspace, 'src', 'backend', 'index.ts');
    const originalBackend = await readFile(backendPath, 'utf8');
    await writeFile(backendPath, originalBackend.replaceAll('API server running', 'Full API changed'), 'utf8');

    await waitFor(async () => {
      expect(stdoutBuffer.text).toContain('backend restarted at');
      expect(await fetchText(port, '/api')).toContain('Full API changed');
    }, 40_000);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled([stdoutDrain, stderrDrain]);
    const childIndex = childProcesses.indexOf(child);
    if (childIndex >= 0) {
      childProcesses.splice(childIndex, 1);
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
}, 60_000);

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

async function collectOutput(
  stream: ReadableStream<Uint8Array>,
  target: { text: string }
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      target.text += decoder.decode(value, { stream: true });
    }

    target.text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
