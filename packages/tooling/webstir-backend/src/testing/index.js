import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { getBackendTestContext, setBackendTestContext } from './context.js';
import { resolveWorkspaceRoot } from '../workspace.js';

const DEFAULT_PORT = 4100;
const DEFAULT_READY_TEXT = 'API server running';
const DEFAULT_READY_TIMEOUT_MS = 15_000;

export { getBackendTestContext, setBackendTestContext };
export async function createBackendTestHarness(options = {}) {
  const resolvedEnv = { ...process.env, ...(options.env ?? {}) };
  const workspaceRoot = resolveWorkspaceRoot({
    workspaceRoot: options.workspaceRoot,
    env: resolvedEnv,
  });
  const buildRoot = resolveWorkspacePath(
    workspaceRoot,
    options.buildRoot ??
      resolvedEnv.WEBSTIR_BACKEND_BUILD_ROOT ??
      path.join(workspaceRoot, 'build', 'backend'),
  );
  const entry = resolveWorkspacePath(
    workspaceRoot,
    options.entry ?? resolvedEnv.WEBSTIR_BACKEND_TEST_ENTRY ?? path.join(buildRoot, 'index.js'),
  );
  const manifestPath = resolveWorkspacePath(
    workspaceRoot,
    options.manifestPath ??
      resolvedEnv.WEBSTIR_BACKEND_TEST_MANIFEST ??
      path.join(workspaceRoot, '.webstir', 'backend-manifest.json'),
  );
  const readyText =
    options.readyText ?? resolvedEnv.WEBSTIR_BACKEND_TEST_READY ?? DEFAULT_READY_TEXT;
  const readyTimeoutMs =
    options.readyTimeoutMs ??
    readInt(resolvedEnv.WEBSTIR_BACKEND_TEST_READY_TIMEOUT, DEFAULT_READY_TIMEOUT_MS);
  if (!existsSync(entry)) {
    throw new Error(
      `Backend test entry not found at ${entry}. Run the backend build before executing backend tests.`,
    );
  }
  const manifest = await loadManifest(manifestPath);
  const requestedPort =
    options.port ?? readInt(resolvedEnv.WEBSTIR_BACKEND_TEST_PORT, DEFAULT_PORT);
  const { child, env, port } = await startBackendTestProcess({
    workspaceRoot,
    entry,
    requestedPort,
    baseEnv: resolvedEnv,
    overrides: options.env,
    readyText,
    readyTimeoutMs,
  });
  const baseUrl = new URL(env.API_BASE_URL ?? `http://127.0.0.1:${port}`);
  const context = {
    baseUrl: baseUrl.toString(),
    url: baseUrl,
    port,
    manifest,
    routes: Array.isArray(manifest?.routes) ? manifest.routes : [],
    env,
    request: async (pathOrUrl = '/', init) => {
      const target = toUrl(baseUrl, pathOrUrl);
      return await fetch(target, init);
    },
  };
  return {
    context,
    async stop() {
      await stopProcess(child);
    },
  };
}
export function backendTest(name, callback) {
  const globalTest = globalThis.test;
  if (typeof globalTest !== 'function') {
    throw new Error('backendTest() requires the @webstir-io/webstir-testing runtime.');
  }
  globalTest(name, async () => {
    const context = getBackendTestContext();
    if (!context) {
      throw new Error(
        'Backend test context not available. Ensure backend tests run via the Webstir CLI (`webstir test`).',
      );
    }
    await callback(context);
  });
}
function toUrl(base, pathOrUrl) {
  if (pathOrUrl instanceof URL) {
    return pathOrUrl.toString();
  }
  if (/^https?:/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return new URL(pathOrUrl, base).toString();
}
function readInt(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function startBackendTestProcess(options) {
  let candidate = options.requestedPort;
  let lastError = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const env = createRuntimeEnv({
      workspaceRoot: options.workspaceRoot,
      port: candidate,
      baseEnv: options.baseEnv,
      overrides: options.overrides,
    });
    const child = spawn(process.execPath, [options.entry], {
      cwd: options.workspaceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = captureChildOutput(child);

    try {
      await waitForReady(child, options.readyText, options.readyTimeoutMs);
      output.stop();
      return { child, env, port: candidate };
    } catch (error) {
      const captured = output.read();
      output.stop();
      await stopProcess(child);
      const message = error instanceof Error ? error.message : String(error);
      const failure = new Error(
        `Backend test server did not become ready on port ${candidate}.\nstdout:\n${captured.stdout}\nstderr:\n${captured.stderr}\nerror:\n${message}`,
      );

      if (attempt < 9 && indicatesPortInUse(captured.stdout, captured.stderr, message)) {
        lastError = failure;
        candidate += 1;
        continue;
      }

      throw failure;
    }
  }

  throw lastError ?? new Error('Backend test server did not become ready.');
}
function createRuntimeEnv(options) {
  const overrides = {};
  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    if (value !== undefined) {
      overrides[key] = value;
    }
  }
  const baseUrl =
    overrides.API_BASE_URL ?? options.baseEnv.API_BASE_URL ?? `http://127.0.0.1:${options.port}`;
  return {
    ...options.baseEnv,
    ...overrides,
    PORT: String(options.port),
    API_BASE_URL: baseUrl,
    NODE_ENV: overrides.NODE_ENV ?? options.baseEnv.NODE_ENV ?? 'test',
    WORKSPACE_ROOT: options.workspaceRoot,
    WEBSTIR_BACKEND_TEST_RUN: '1',
  };
}

function captureChildOutput(child) {
  let stdout = '';
  let stderr = '';

  const onStdout = (chunk) => {
    stdout += chunk.toString();
  };
  const onStderr = (chunk) => {
    stderr += chunk.toString();
  };

  child.stdout?.on('data', onStdout);
  child.stderr?.on('data', onStderr);

  return {
    stop() {
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
    },
    read() {
      return { stdout, stderr };
    },
  };
}

function indicatesPortInUse(stdout, stderr, message) {
  return [stdout, stderr, message].some(
    (value) =>
      value.includes('EADDRINUSE') ||
      value.includes('address already in use') ||
      value.includes('Failed to listen at 127.0.0.1'),
  );
}

function resolveWorkspacePath(workspaceRoot, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}
async function loadManifest(manifestPath) {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function emitModuleEvent(level, message) {
  const payload = JSON.stringify({ type: level, message });
  process.stdout.write(`WEBSTIR_MODULE_EVENT ${payload}\n`);
}
async function waitForReady(child, readyText, timeoutMs) {
  const normalized = readyText
    .split('|')
    .map((token) => token.trim())
    .filter(Boolean);
  const readinessMatches = (line) =>
    normalized.length === 0 ? line.length > 0 : normalized.some((token) => line.includes(token));
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      child.stdout?.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      child.off('exit', onExit);
      clearTimeout(timer);
    };
    const onStdout = (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        emitModuleEvent('info', line);
        if (readinessMatches(line)) {
          cleanup();
          resolve();
        }
      }
    };
    const onStderr = (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (!line) continue;
        emitModuleEvent('error', line);
        if (readinessMatches(line)) {
          cleanup();
          resolve();
        }
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(
        new Error(`Backend test server exited before it became ready (code ${code ?? 'null'}).`),
      );
    };
    const timer = setTimeout(() => {
      cleanup();
      emitModuleEvent('error', 'Backend test server readiness timed out.');
      reject(
        new Error(
          `Backend test server did not become ready within ${timeoutMs}ms. Check server logs for details.`,
        ),
      );
    }, timeoutMs);
    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('exit', onExit);
  });
}
async function stopProcess(child) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  try {
    await once(child, 'exit');
  } catch {
    // ignore
  }
}
