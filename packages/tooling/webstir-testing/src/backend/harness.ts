import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

import { getBackendTestContext, setBackendTestContext } from './context.js';
import type { BackendTestContext, BackendTestHarness } from './types.js';

const DEFAULT_READY_TEXT = 'API server running';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_START_ATTEMPTS = 10;

export { getBackendTestContext, setBackendTestContext };

export async function createBackendTestHarness(): Promise<BackendTestHarness> {
  const workspaceRoot = process.env.WEBSTIR_WORKSPACE_ROOT ?? process.cwd();
  const buildRoot =
    process.env.WEBSTIR_BACKEND_BUILD_ROOT ?? path.join(workspaceRoot, 'build', 'backend');
  const entry = process.env.WEBSTIR_BACKEND_TEST_ENTRY ?? path.join(buildRoot, 'index.js');
  const manifestPath =
    process.env.WEBSTIR_BACKEND_TEST_MANIFEST ??
    path.join(workspaceRoot, '.webstir', 'backend-manifest.json');
  const readyText = process.env.WEBSTIR_BACKEND_TEST_READY ?? DEFAULT_READY_TEXT;
  const timeoutMs = readInt(process.env.WEBSTIR_BACKEND_TEST_READY_TIMEOUT, DEFAULT_TIMEOUT_MS);
  const requestedPort = readInt(process.env.WEBSTIR_BACKEND_TEST_PORT, 0);

  if (!existsSync(entry)) {
    throw new Error(
      `Backend test entry not found at ${entry}. Run a backend build before executing backend tests.`,
    );
  }

  const { server, env, port } = await startServer(
    workspaceRoot,
    entry,
    requestedPort,
    readyText,
    timeoutMs,
  );

  const manifest = await loadManifest(manifestPath);
  const baseUrl = new URL(env.API_BASE_URL ?? `http://127.0.0.1:${port}`);
  const context: BackendTestContext = {
    baseUrl: baseUrl.toString(),
    url: baseUrl,
    port,
    manifest,
    env,
    request: async (pathOrUrl = '/', init) => {
      const target = toUrl(baseUrl, pathOrUrl);
      return await fetch(target, init);
    },
  };

  return {
    context,
    async stop() {
      await stopProcess(server);
    },
  };
}

async function startServer(
  workspaceRoot: string,
  entry: string,
  requestedPort: number,
  readyText: string,
  timeoutMs: number,
): Promise<{ server: ChildProcess; env: Record<string, string>; port: number }> {
  let nextExplicitPort = requestedPort;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt += 1) {
    const port =
      requestedPort > 0 ? await findOpenPort(nextExplicitPort) : await reserveEphemeralPort();
    const env = createRuntimeEnv(workspaceRoot, port);
    const server = spawn(process.execPath, [entry], {
      cwd: workspaceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = captureOutput(server);
    const closed = once(server, 'close').catch(() => undefined);

    try {
      await waitForReady(server, readyText, timeoutMs);
      output.stop();
      return { server, env, port };
    } catch (error) {
      await stopProcess(server);
      await closed;
      output.stop();
      if (!indicatesPortInUse(output.read(), error)) {
        throw error;
      }
      lastError = error;
      nextExplicitPort = port + 1;
    }
  }

  throw lastError;
}

function createRuntimeEnv(workspaceRoot: string, port: number): Record<string, string> {
  return {
    ...process.env,
    PORT: String(port),
    API_BASE_URL: process.env.API_BASE_URL ?? `http://127.0.0.1:${port}`,
    NODE_ENV: process.env.NODE_ENV ?? 'test',
    WORKSPACE_ROOT: workspaceRoot,
    WEBSTIR_BACKEND_TEST_RUN: '1',
  } as Record<string, string>;
}

function readInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function findOpenPort(start: number, attempts = 10): Promise<number> {
  for (let port = start, remaining = attempts; remaining > 0; port += 1, remaining -= 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`Unable to find an open port for backend tests (starting at ${start}).`);
}

function reserveEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        if (port > 0) {
          resolve(port);
        } else {
          reject(new Error('Unable to reserve an open port for backend tests.'));
        }
      });
    });
  });
}

function captureOutput(child: ChildProcess): { stop(): void; read(): string } {
  let output = '';
  const onData = (chunk: Buffer | string) => {
    output += chunk.toString();
  };

  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);

  return {
    stop() {
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
    },
    read() {
      return output;
    },
  };
}

function indicatesPortInUse(output: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [output, message].some(
    (value) =>
      value.includes('EADDRINUSE') ||
      value.includes('address already in use') ||
      value.includes('Failed to listen at'),
  );
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      server.close(() => resolve(false));
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function waitForReady(
  child: ChildProcess,
  readyText: string,
  timeoutMs: number,
): Promise<void> {
  const markers = readyText
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean);

  const matches = (line: string) =>
    markers.length === 0 ? line.length > 0 : markers.some((token) => line.includes(token));

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('exit', onExit);
      clearTimeout(timer);
    };

    const onStdout = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line) {
          emitModuleEvent('info', line);
          if (matches(line)) {
            cleanup();
            resolve();
          }
        }
      }
    };

    const onStderr = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line) {
          emitModuleEvent('error', line);
          if (matches(line)) {
            cleanup();
            resolve();
          }
        }
      }
    };

    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Backend test server exited before it was ready (code ${code ?? 'null'}).`));
    };

    const timer = setTimeout(() => {
      cleanup();
      emitModuleEvent('error', 'Backend test server readiness timed out.');
      reject(new Error(`Backend test server did not become ready within ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('exit', onExit);
  });
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  try {
    await once(child, 'exit');
  } catch {
    // ignore
  }
}

async function loadManifest(filePath: string): Promise<unknown> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toUrl(base: URL, value: string | URL): string {
  if (value instanceof URL) {
    return value.toString();
  }
  if (/^https?:/i.test(value)) {
    return value;
  }
  return new URL(value, base).toString();
}

function emitModuleEvent(level: 'info' | 'warn' | 'error', message: string): void {
  const payload = JSON.stringify({ type: level, message });
  process.stdout.write(`WEBSTIR_MODULE_EVENT ${payload}\n`);
}
