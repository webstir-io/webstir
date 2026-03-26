import net from 'node:net';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import type { DeploymentIo, PublishedWorkspaceMode } from './deploy-shared.js';
import { resolveRuntimeCommand, textResponse } from './deploy-shared.js';

interface RuntimeProcessRecord {
  readonly child: ChildProcessByStdio<null, Readable, Readable>;
  readonly exitPromise: Promise<number | null>;
  expectedExit: boolean;
}

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 100;
const SOCKET_TIMEOUT_MS = 200;

export function startBackendProcess(options: {
  readonly workspaceRoot: string;
  readonly backendEntry: string;
  readonly port: number;
  readonly env?: Record<string, string | undefined>;
  readonly io: DeploymentIo;
}): RuntimeProcessRecord {
  const child = spawn(resolveRuntimeCommand(), [options.backendEntry], {
    cwd: options.workspaceRoot,
    env: {
      ...process.env,
      ...options.env,
      PORT: String(options.port),
      NODE_ENV: options.env?.NODE_ENV ?? process.env.NODE_ENV ?? 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    options.io.stdout.write(`[backend] ${chunk}`);
  });
  child.stderr.on('data', (chunk: string) => {
    options.io.stderr.write(`[backend] ${chunk}`);
  });

  const exitPromise = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code));
  });

  return {
    child,
    exitPromise,
    expectedExit: false,
  };
}

export async function waitForRuntimeReady(
  port: number,
  exitPromise: Promise<number | null>,
): Promise<void> {
  const abortController = new AbortController();

  try {
    await Promise.race([
      waitForPortOpen(port, abortController.signal),
      exitPromise.then((code) => {
        throw new Error(`Backend runtime exited before it became ready (code ${code ?? 'null'}).`);
      }),
      delay(READY_TIMEOUT_MS).then(() => {
        throw new Error(`Backend runtime did not become ready within ${READY_TIMEOUT_MS}ms.`);
      }),
    ]);
  } finally {
    abortController.abort();
  }
}

export async function proxyRequest(
  request: Request,
  requestUrl: URL,
  proxyPath: string,
  backendOrigin: string,
  mode: PublishedWorkspaceMode,
): Promise<Response> {
  const targetUrl = new URL(proxyPath + requestUrl.search, backendOrigin);

  try {
    const requestInit = createProxyRequestInit(request, targetUrl);
    const proxyResponse = await fetch(targetUrl, requestInit);
    const headers = rewriteProxyResponseHeaders(proxyResponse.headers, targetUrl, mode);

    return new Response(request.method !== 'HEAD' ? proxyResponse.body : null, {
      status: proxyResponse.status,
      headers,
    });
  } catch {
    return textResponse(502, 'Backend proxy failed.');
  }
}

export function shouldProxyToBackend(request: Request, pathname: string): boolean {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return true;
  }

  return (
    pathname === '/api' ||
    pathname === '/api/health' ||
    pathname.startsWith('/api/') ||
    pathname === '/healthz' ||
    pathname === '/readyz' ||
    pathname === '/metrics'
  );
}

export function getFullWorkspaceProxyPath(pathname: string): string {
  if (pathname === '/healthz' || pathname === '/readyz' || pathname === '/metrics') {
    return pathname;
  }

  if (pathname === '/api') {
    return '/';
  }

  if (pathname === '/api/health') {
    return '/api/health';
  }

  if (pathname.startsWith('/api/')) {
    const normalizedPath = pathname.slice('/api'.length);
    return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  }

  return pathname;
}

async function waitForPortOpen(port: number, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    if (await canConnectToPort(port)) {
      return;
    }

    await delay(READY_POLL_MS, undefined, { signal }).catch(() => undefined);
  }

  throw new Error('Backend readiness check was aborted.');
}

async function canConnectToPort(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function rewriteProxyResponseHeaders(
  headers: Headers,
  targetUrl: URL,
  mode: PublishedWorkspaceMode,
): Headers {
  const nextHeaders = new Headers(headers);
  const location = headers.get('location');
  if (!location) {
    return nextHeaders;
  }

  nextHeaders.set('location', rewriteProxyLocation(location, targetUrl, mode));
  return nextHeaders;
}

function rewriteProxyLocation(value: string, targetUrl: URL, mode: PublishedWorkspaceMode): string {
  const trimmed = value.trim();
  if (!trimmed || mode === 'api') {
    return value;
  }

  if (trimmed.startsWith('/')) {
    return prefixApiMount(trimmed);
  }

  try {
    const resolved = new URL(trimmed, targetUrl.origin);
    if (resolved.origin !== targetUrl.origin) {
      return value;
    }
    return prefixApiMount(`${resolved.pathname}${resolved.search}${resolved.hash}`);
  } catch {
    return value;
  }
}

function prefixApiMount(pathname: string): string {
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return pathname;
  }

  return pathname === '/' ? '/api' : `/api${pathname}`;
}

function createProxyRequestInit(
  request: Request,
  targetUrl: URL,
): RequestInit & { duplex?: 'half' } {
  const headers = new Headers(request.headers);
  headers.set('host', targetUrl.host);
  headers.set('connection', 'close');

  const requestInit: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: request.signal,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    requestInit.body = request.body;
    if (request.body) {
      requestInit.duplex = 'half';
    }
  }

  return requestInit;
}
