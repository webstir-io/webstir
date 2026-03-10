import http from 'node:http';

import { module as demoModule } from './module.js';

type IncomingRequest = http.IncomingMessage;
type ServerResponse = http.ServerResponse<IncomingRequest>;

interface RouteMatch {
  readonly path: string;
  readonly method: string;
}

interface RouteContext {
  readonly request: IncomingRequest;
  readonly reply: ServerResponse;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

interface RouteResult {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  readonly redirect?: {
    readonly location: string;
  };
  readonly fragment?: {
    readonly target: string;
    readonly selector?: string;
    readonly mode?: 'replace' | 'append' | 'prepend';
    readonly body: unknown;
  };
}

interface DemoRoute {
  readonly definition?: RouteMatch;
  readonly handler?: (context: RouteContext) => Promise<RouteResult> | RouteResult;
}

const routes: readonly DemoRoute[] = Array.isArray(demoModule.routes) ? demoModule.routes : [];
const PORT = Number(process.env.PORT || 4321);

const server = http.createServer((request, response) => {
  void handleRequest(request, response);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API server running at http://localhost:${PORT}`);
});

async function handleRequest(request: IncomingRequest, response: ServerResponse): Promise<void> {
  if (!request.url) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'bad_request' }));
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('API server running');
    return;
  }

  const route = findRoute(url.pathname, request.method ?? 'GET');
  if (!route?.handler) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  const body = await readBody(request);
  const result = await route.handler({
    request,
    reply: response,
    query: Object.fromEntries(url.searchParams.entries()),
    body
  });

  sendRouteResponse(response, result);
}

function findRoute(pathname: string, method: string): DemoRoute | undefined {
  const normalizedMethod = method.toUpperCase();
  return routes.find((route) =>
    route.definition?.path === pathname && route.definition?.method === normalizedMethod
  );
}

async function readBody(request: IncomingRequest): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  if (!rawBody) {
    return undefined;
  }

  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

function sendRouteResponse(response: ServerResponse, result: RouteResult): void {
  const status = result.redirect ? (result.status ?? 303) : (result.status ?? 200);
  const headers: Record<string, string> = { ...(result.headers ?? {}) };

  if (result.redirect) {
    headers.location = result.redirect.location;
  }

  if (result.fragment) {
    headers['x-webstir-fragment-target'] = result.fragment.target;
    if (result.fragment.selector) {
      headers['x-webstir-fragment-selector'] = result.fragment.selector;
    }
    if (result.fragment.mode) {
      headers['x-webstir-fragment-mode'] = result.fragment.mode;
    }
  }

  const payload = result.fragment?.body ?? result.body;
  if (payload !== undefined && payload !== null && !hasHeader(headers, 'content-type')) {
    headers['content-type'] = typeof payload === 'string'
      ? 'text/html; charset=utf-8'
      : 'application/json';
  }

  response.writeHead(status, headers);

  if (result.redirect || payload === undefined || payload === null) {
    response.end('');
    return;
  }

  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    response.end(payload);
    return;
  }

  response.end(JSON.stringify(payload));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lowerName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lowerName);
}

export default server;
