import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type ReloadableServeServer = ReturnType<typeof Bun.serve> & {
  reload(options: unknown): unknown;
};

export interface BunFrontendFetchHandlerOptions {
  readonly apiProxyOrigin?: string;
}

export interface BunSpaRouteEntry {
  readonly routes: readonly string[];
  readonly entry: BodyInit;
}

export async function loadBunSpaEntry(generatedEntryPath: string): Promise<BodyInit> {
  const routeModule = await import(
    `${pathToFileURL(generatedEntryPath).href}?t=${Date.now()}`
  ) as { default: unknown };
  return routeModule.default as BodyInit;
}

export function createBunSpaRoutes(entries: readonly BunSpaRouteEntry[]) {
  const routes: Record<string, BodyInit | false> = {
    '/api': false,
    '/api/*': false,
  };

  for (const entry of entries) {
    for (const route of entry.routes) {
      routes[route] = entry.entry;
    }
  }

  return routes;
}

export function createBunFrontendFetchHandler(options: BunFrontendFetchHandlerOptions = {}) {
  return async (request: Request) => {
    const requestUrl = new URL(request.url);
    const apiProxyPath = getApiProxyPath(requestUrl.pathname);
    if (apiProxyPath !== null) {
      if (!options.apiProxyOrigin) {
        return new Response('Not found.', { status: 404 });
      }

      return await proxyApiRequest(request, requestUrl, apiProxyPath, options.apiProxyOrigin);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed.', { status: 405 });
    }

    return new Response('Not found.', { status: 404 });
  };
}

function getApiProxyPath(pathname: string): string | null {
  if (pathname === '/api') {
    return '/';
  }

  if (pathname.startsWith('/api/')) {
    const normalizedPath = path.posix.normalize(pathname.slice('/api'.length));
    return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
  }

  return null;
}

async function proxyApiRequest(
  request: Request,
  requestUrl: URL,
  apiProxyPath: string,
  apiProxyOrigin: string
): Promise<Response> {
  const targetUrl = new URL(apiProxyPath + requestUrl.search, apiProxyOrigin);

  try {
    const proxyResponse = await fetch(targetUrl, createProxyRequestInit(request, targetUrl));
    const headers = rewriteProxyResponseHeaders(proxyResponse.headers, targetUrl);

    return new Response(request.method !== 'HEAD' ? proxyResponse.body : null, {
      status: proxyResponse.status || 502,
      headers,
    });
  } catch {
    return new Response('Backend proxy failed.', { status: 502 });
  }
}

function rewriteProxyResponseHeaders(
  headers: Headers,
  targetUrl: URL
): Headers {
  const nextHeaders = new Headers(headers);
  const location = headers.get('location');
  if (location) {
    nextHeaders.set('location', rewriteProxyLocation(location, targetUrl));
  }

  return nextHeaders;
}

function createProxyRequestInit(request: Request, targetUrl: URL): RequestInit & { duplex?: 'half' } {
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

  return pathname === '/'
    ? '/api'
    : `/api${pathname}`;
}

function methodAllowsBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}
