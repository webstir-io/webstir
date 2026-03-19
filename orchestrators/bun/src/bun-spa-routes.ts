import { pathToFileURL } from 'node:url';

export type ReloadableServeServer = ReturnType<typeof Bun.serve> & {
  reload(options: unknown): unknown;
};

export async function loadBunSpaEntry(generatedEntryPath: string): Promise<BodyInit> {
  const routeModule = await import(
    `${pathToFileURL(generatedEntryPath).href}?t=${Date.now()}`
  ) as { default: unknown };
  return routeModule.default as BodyInit;
}

export function createBunSpaRoutes(spaEntry: BodyInit) {
  return {
    '/api/*': false,
    '/': spaEntry,
    '/*': spaEntry,
  };
}

export function createBunSpaFallbackFetchHandler() {
  return (request: Request) => {
    const requestUrl = new URL(request.url);
    const pathname = requestUrl.pathname;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed.', { status: 405 });
    }

    if (pathname.startsWith('/api/')) {
      return new Response('Not found.', { status: 404 });
    }

    return new Response('Not found.', { status: 404 });
  };
}
