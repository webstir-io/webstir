import path from 'node:path';
import { access } from 'node:fs/promises';

import type { HotUpdatePayload, WatchStatus } from './watch-events.ts';

export interface DevServerOptions {
  readonly buildRoot: string;
  readonly host?: string;
  readonly port?: number;
  readonly apiProxyOrigin?: string;
}

export interface DevServerAddress {
  readonly host: string;
  readonly port: number;
  readonly origin: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const RESERVED_PREFIXES = ['__webstir', 'api', 'fonts', 'images', 'media', 'pages', 'sse'];
const STATIC_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.mp4',
  '.webm',
  '.mov',
  '.json',
  '.txt',
  '.xml',
  '.map',
]);
const CONTENT_HASH_PATTERN =
  /\.[a-f0-9]{8,64}\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|eot|mp3|m4a|wav|ogg|mp4|webm|mov)$/i;

interface SseClient {
  send(message: string): void;
  close(): void;
}

export class DevServer {
  private readonly buildRoot: string;
  private readonly host: string;
  private readonly port: number;
  private readonly apiProxyOrigin?: string;
  private readonly clients = new Set<SseClient>();
  private server?: ReturnType<typeof Bun.serve>;

  public constructor(options: DevServerOptions) {
    this.buildRoot = path.resolve(options.buildRoot);
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 8088;
    this.apiProxyOrigin = options.apiProxyOrigin;
  }

  public async start(): Promise<DevServerAddress> {
    if (this.server) {
      return this.getAddress();
    }

    this.server = Bun.serve({
      hostname: this.host,
      idleTimeout: 0,
      port: this.port,
      fetch: (request) => {
        return this.handleRequest(request);
      },
    });

    return this.getAddress();
  }

  public async stop(): Promise<void> {
    await this.broadcastRaw('data: shutdown\n\n');

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    server.stop();
  }

  public async publishStatus(status: WatchStatus): Promise<void> {
    await this.broadcastEvent('status', status);
  }

  public async publishReload(): Promise<void> {
    await this.broadcastRaw('data: reload\n\n');
  }

  public async publishHotUpdate(payload: HotUpdatePayload): Promise<void> {
    await this.broadcastEvent('hmr', JSON.stringify(payload));
  }

  private getAddress(): DevServerAddress {
    if (!this.server) {
      throw new Error('Dev server has not started.');
    }

    const originHost = this.host === '0.0.0.0' ? '127.0.0.1' : this.host;
    return {
      host: originHost,
      port: this.server.port,
      origin: `http://${originHost}:${this.server.port}`,
    };
  }

  private async handleRequest(request: Request): Promise<Response> {
    const method = request.method || 'GET';
    const requestUrl = new URL(request.url);
    const { pathname } = requestUrl;

    if (pathname === '/sse') {
      return this.handleSse(request);
    }

    const apiProxyPath = getApiProxyPath(pathname);
    if (apiProxyPath !== null && this.apiProxyOrigin) {
      return await this.handleApiProxy(request, requestUrl, apiProxyPath);
    }

    if (method !== 'GET' && method !== 'HEAD') {
      return textResponse(405, 'Method not allowed.');
    }

    const candidates = getStaticCandidatePaths(pathname);
    const resolved = await resolveStaticFile(this.buildRoot, candidates);
    if (!resolved) {
      return textResponse(404, 'Not found.');
    }

    const lowerRelativePath = resolved.relativePath.toLowerCase();
    const extension = path.extname(lowerRelativePath).toLowerCase();
    const headers = new Headers({
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
    });
    setCacheHeaders(headers, lowerRelativePath);

    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers,
      });
    }

    return new Response(Bun.file(resolved.absolutePath), {
      status: 200,
      headers,
    });
  }

  private async handleApiProxy(
    request: Request,
    requestUrl: URL,
    apiProxyPath: string,
  ): Promise<Response> {
    const targetUrl = new URL(apiProxyPath + requestUrl.search, this.apiProxyOrigin);

    try {
      const requestInit = createProxyRequestInit(request, targetUrl);
      const proxyResponse = await fetch(targetUrl, requestInit);
      const headers = rewriteProxyResponseHeaders(proxyResponse.headers, targetUrl);

      return new Response(request.method !== 'HEAD' ? proxyResponse.body : null, {
        status: proxyResponse.status || 502,
        headers,
      });
    } catch {
      return textResponse(502, 'Backend proxy failed.');
    }
  }

  private handleSse(request: Request): Response {
    const encoder = new TextEncoder();
    let client: SseClient | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const cleanup = () => {
          if (!client) {
            return;
          }

          this.clients.delete(client);
          try {
            controller.close();
          } catch {
            // The stream is already closed.
          }
          request.signal.removeEventListener('abort', cleanup);
          client = undefined;
        };

        client = {
          send: (message) => {
            try {
              controller.enqueue(encoder.encode(message));
            } catch {
              cleanup();
            }
          },
          close: cleanup,
        };

        this.clients.add(client);
        controller.enqueue(encoder.encode('\n'));
        request.signal.addEventListener('abort', cleanup, { once: true });
      },
      cancel: () => {
        client?.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  private async broadcastEvent(eventName: string, data: string): Promise<void> {
    await this.broadcastRaw(`event: ${eventName}\ndata: ${data}\n\n`);
  }

  private async broadcastRaw(message: string): Promise<void> {
    for (const client of Array.from(this.clients)) {
      try {
        client.send(message);
      } catch {
        client.close();
        this.clients.delete(client);
      }
    }
  }
}

export function getStaticCandidatePaths(pathname: string): readonly string[] {
  const relativePath = normalizeRequestPath(pathname);
  const candidates: string[] = [];

  if (relativePath) {
    candidates.push(...getGenericFileCandidates(relativePath));
  }

  if (relativePath === '') {
    candidates.push('pages/home/index.html');
  } else if (/^index\.(?!html$)[^/]+$/i.test(relativePath)) {
    candidates.push(path.posix.join('pages', 'home', relativePath));
  } else if (/^[^/]+\/index\.(js|css)$/i.test(relativePath)) {
    const [pageName, fileName] = relativePath.split('/');
    candidates.push(path.posix.join('pages', pageName, fileName));
  } else if (!path.posix.extname(relativePath) && !hasReservedPrefix(relativePath)) {
    candidates.push(path.posix.join('pages', relativePath, 'index.html'));
  }

  return Array.from(new Set(candidates.map((candidate) => candidate.replace(/^\/+/, ''))));
}

export function getApiProxyPath(pathname: string): string | null {
  if (pathname === '/api') {
    return '/';
  }

  if (pathname.startsWith('/api/')) {
    const normalizedPath = path.posix.normalize(pathname.slice('/api'.length));
    return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  }

  return null;
}

function rewriteProxyResponseHeaders(headers: Headers, targetUrl: URL): Headers {
  const nextHeaders = new Headers(headers);
  const location = headers.get('location');
  if (location) {
    nextHeaders.set('location', rewriteProxyLocation(location, targetUrl));
  }

  return nextHeaders;
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

  if (methodAllowsBody(request.method)) {
    requestInit.body = request.body;
    if (request.body) {
      requestInit.duplex = 'half';
    }
  }

  return requestInit;
}

function rewriteProxyLocation(value: string, targetUrl: URL): string {
  const trimmed = value.trim();
  if (!trimmed) {
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

async function resolveStaticFile(
  buildRoot: string,
  relativePaths: readonly string[],
): Promise<{ absolutePath: string; relativePath: string } | null> {
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(buildRoot, relativePath);
    if (!absolutePath.startsWith(buildRoot + path.sep) && absolutePath !== buildRoot) {
      continue;
    }

    try {
      await access(absolutePath);
      return { absolutePath, relativePath };
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function normalizeRequestPath(pathname: string): string {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.posix.normalize(decoded);
  const stripped = normalized.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '');
  return stripped.replace(/\/+$/, '');
}

function getGenericFileCandidates(relativePath: string): readonly string[] {
  const hasExtension = path.posix.extname(relativePath) !== '';
  const candidates = hasExtension
    ? [relativePath]
    : [relativePath, `${relativePath}.html`, path.posix.join(relativePath, 'index.html')];

  return candidates;
}

function hasReservedPrefix(relativePath: string): boolean {
  return RESERVED_PREFIXES.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`),
  );
}

function setCacheHeaders(headers: Headers, relativePath: string): void {
  if (CONTENT_HASH_PATTERN.test(relativePath)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  if (relativePath.endsWith('refresh.js') || relativePath.endsWith('hmr.js')) {
    setNoCacheHeaders(headers);
    return;
  }

  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.html' || extension === '') {
    setNoCacheHeaders(headers);
    return;
  }

  if (STATIC_EXTENSIONS.has(extension)) {
    headers.set('Cache-Control', 'no-cache, must-revalidate');
  }
}

function setNoCacheHeaders(headers: Headers): void {
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
}

function textResponse(statusCode: number, body: string): Response {
  return new Response(body, {
    status: statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function methodAllowsBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}
