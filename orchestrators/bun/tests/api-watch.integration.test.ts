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

test('CLI watch serves the API demo, restarts after a successful rebuild, and survives a failed rebuild', async () => {
  const fixtureRoot = path.join(repoRoot, 'examples', 'demos', 'api');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-api-watch-'));
  const workspace = path.join(tempRoot, 'api');
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
      expect(await fetchText(port)).toContain('API server running');
    }, 20_000);

    const sourcePath = path.join(workspace, 'src', 'backend', 'index.ts');
    const originalSource = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, originalSource.replace('API server running', 'API server changed'), 'utf8');

    await waitFor(async () => {
      expect(await fetchText(port)).toContain('API server changed');
    }, 20_000);

    await writeFile(sourcePath, "import http from 'node:http';\nconst broken = ;\n", 'utf8');
    await waitFor(async () => {
      expect(stderrBuffer.text).toContain('backend rebuild failed; keeping the current runtime process');
    }, 20_000);

    const exitState = await Promise.race([
      child.exited.then(() => 'exited'),
      Bun.sleep(250).then(() => 'running'),
    ]);

    expect(exitState).toBe('running');
    expect(await fetchText(port)).toContain('API server changed');
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

async function fetchText(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/`);
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
