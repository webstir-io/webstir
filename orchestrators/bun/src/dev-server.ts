import path from 'node:path';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
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
  '.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.m4a', '.wav', '.ogg', '.mp4',
  '.webm', '.mov', '.json', '.txt', '.xml', '.map',
]);
const CONTENT_HASH_PATTERN = /\.[a-f0-9]{8,64}\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|eot|mp3|m4a|wav|ogg|mp4|webm|mov)$/i;

interface SseClient {
  readonly response: ServerResponse<IncomingMessage>;
}

export class DevServer {
  private readonly buildRoot: string;
  private readonly host: string;
  private readonly port: number;
  private readonly apiProxyOrigin?: string;
  private readonly clients = new Set<SseClient>();
  private server?: http.Server;

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

    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, this.host, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });

    return this.getAddress();
  }

  public async stop(): Promise<void> {
    await this.broadcastRaw('data: shutdown\n\n');

    for (const client of this.clients) {
      client.response.end();
    }
    this.clients.clear();

    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
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

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Dev server did not expose a TCP address.');
    }

    const originHost = this.host === '0.0.0.0' ? '127.0.0.1' : this.host;
    return {
      host: originHost,
      port: address.port,
      origin: `http://${originHost}:${address.port}`,
    };
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>
  ): Promise<void> {
    if (!request.url) {
      this.writeText(response, 400, 'Bad request.');
      return;
    }

    const method = request.method ?? 'GET';

    const requestUrl = new URL(request.url, 'http://localhost');
    const { pathname } = requestUrl;
    if (pathname === '/sse') {
      this.handleSse(response);
      return;
    }

    const apiProxyPath = getApiProxyPath(pathname);
    if (apiProxyPath !== null && this.apiProxyOrigin) {
      await this.handleApiProxy(request, response, requestUrl, apiProxyPath);
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      this.writeText(response, 405, 'Method not allowed.');
      return;
    }

    const candidates = getStaticCandidatePaths(pathname);
    const resolved = await resolveStaticFile(this.buildRoot, candidates);
    if (!resolved) {
      this.writeText(response, 404, 'Not found.');
      return;
    }

    const lowerRelativePath = resolved.relativePath.toLowerCase();
    const extension = path.extname(lowerRelativePath).toLowerCase();
    response.setHeader('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream');
    setCacheHeaders(response, lowerRelativePath);

    if (method === 'HEAD') {
      response.statusCode = 200;
      response.end();
      return;
    }

    const stream = createReadStream(resolved.absolutePath);
    stream.once('error', () => {
      if (!response.headersSent) {
        this.writeText(response, 500, 'Failed to read file.');
      } else {
        response.destroy();
      }
    });
    stream.pipe(response);
  }

  private async handleApiProxy(
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
    requestUrl: URL,
    apiProxyPath: string
  ): Promise<void> {
    const targetUrl = new URL(apiProxyPath + requestUrl.search, this.apiProxyOrigin);

    await new Promise<void>((resolve) => {
      const proxyRequest = http.request(targetUrl, {
        agent: false,
        method: request.method,
        headers: {
          ...request.headers,
          host: targetUrl.host,
          connection: 'close',
        },
      }, (proxyResponse) => {
        const headers = rewriteProxyResponseHeaders(proxyResponse.headers, targetUrl);
        response.writeHead(proxyResponse.statusCode ?? 502, headers);
        proxyResponse.pipe(response);
        proxyResponse.once('end', resolve);
        proxyResponse.once('error', () => {
          if (!response.headersSent) {
            this.writeText(response, 502, 'Backend proxy read failed.');
          } else {
            response.destroy();
          }
          resolve();
        });
      });

      proxyRequest.once('error', () => {
        if (!response.headersSent) {
          this.writeText(response, 502, 'Backend proxy failed.');
        } else {
          response.destroy();
        }
        resolve();
      });

      if (request.method === 'GET' || request.method === 'HEAD') {
        proxyRequest.end();
        return;
      }

      request.pipe(proxyRequest);
    });
  }

  private handleSse(response: ServerResponse<IncomingMessage>): void {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const client = { response };
    this.clients.add(client);
    response.write('\n');

    response.once('close', () => {
      this.clients.delete(client);
    });
  }

  private async broadcastEvent(eventName: string, data: string): Promise<void> {
    await this.broadcastRaw(`event: ${eventName}\ndata: ${data}\n\n`);
  }

  private async broadcastRaw(message: string): Promise<void> {
    for (const client of Array.from(this.clients)) {
      try {
        client.response.write(message);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private writeText(
    response: ServerResponse<IncomingMessage>,
    statusCode: number,
    body: string
  ): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(body);
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

  return Array.from(new Set(candidates.map(candidate => candidate.replace(/^\/+/, ''))));
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

function rewriteProxyResponseHeaders(
  headers: http.IncomingHttpHeaders,
  targetUrl: URL
): http.OutgoingHttpHeaders {
  const nextHeaders: http.OutgoingHttpHeaders = { ...headers };
  const rewrite = (value: string) => rewriteProxyLocation(value, targetUrl);

  if (typeof headers.location === 'string') {
    nextHeaders.location = rewrite(headers.location);
  }

  return nextHeaders;
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

  return pathname === '/'
    ? '/api'
    : `/api${pathname}`;
}

async function resolveStaticFile(
  buildRoot: string,
  relativePaths: readonly string[]
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
  return RESERVED_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

function setCacheHeaders(response: ServerResponse<IncomingMessage>, relativePath: string): void {
  if (CONTENT_HASH_PATTERN.test(relativePath)) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  if (relativePath.endsWith('refresh.js') || relativePath.endsWith('hmr.js')) {
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    return;
  }

  const extension = path.extname(relativePath).toLowerCase();
  if (extension === '.html' || extension === '') {
    response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    return;
  }

  if (STATIC_EXTENSIONS.has(extension)) {
    response.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
}
