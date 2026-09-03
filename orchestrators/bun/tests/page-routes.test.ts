import { expect, test } from 'bun:test';

import { matchPageRoute, normalizePageRoutes } from '@webstir-io/webstir-backend';

import {
  assertPageRoutesCompatible,
  resolvePageRoutes,
} from '../src/bun-generated-frontend-watch.ts';

const pageRoutes = normalizePageRoutes([
  { name: 'proposal', path: '/clients/:client/proposals/:proposal', page: 'proposal' },
  { name: 'version', path: '/clients/:client/proposals/:proposal/:version', page: 'proposal' },
  { name: 'record', path: '/clients/:client/proposals/:proposal/manage', page: 'proposal-viewer' },
]);

test('resolvePageRoutes adds each view pattern for its page with and without a trailing slash', () => {
  expect(
    resolvePageRoutes({ name: 'proposal', routePath: '/proposal' }, false, pageRoutes),
  ).toEqual([
    '/proposal',
    '/proposal/',
    '/proposal/index.html',
    '/clients/:client/proposals/:proposal',
    '/clients/:client/proposals/:proposal/',
    '/clients/:client/proposals/:proposal/:version',
    '/clients/:client/proposals/:proposal/:version/',
  ]);
  expect(
    resolvePageRoutes(
      { name: 'proposal-viewer', routePath: '/proposal-viewer' },
      false,
      pageRoutes,
    ),
  ).toContain('/clients/:client/proposals/:proposal/manage');
  expect(resolvePageRoutes({ name: 'clients', routePath: '/clients' }, false, pageRoutes)).toEqual([
    '/clients',
    '/clients/',
    '/clients/index.html',
  ]);
});

test('resolvePageRoutes keeps the root page aliases', () => {
  expect(resolvePageRoutes({ name: 'home', routePath: '/' }, true, pageRoutes)).toEqual([
    '/',
    '/index.html',
    '/home',
    '/home/',
    '/home/index.html',
  ]);
});

test('the published matcher picks the same pattern Bun.serve serves for overlapping routes', async () => {
  const patterns = [
    '/:x/foo/:z',
    '/bar/:y/:z',
    '/a/:x/c',
    '/:x/b/c',
    '/a/b/:y',
    '/a/:x/:y',
    '/:p/:q/c',
    '/k/:x/:y/:z',
    '/:x/k/:y/:z',
    '/m/:x/n/:y',
    '/m/:x/:y/o',
    '/:x/m/n/:y',
    '/clients/:client',
    '/clients/:client/proposals/:proposal',
    '/clients/:client/proposals/:proposal/manage',
    '/clients/:client/proposals/:proposal/:version',
  ];
  const routes = normalizePageRoutes(
    patterns.map((pattern, index) => ({ path: pattern, page: `p${index}` })),
  );
  const bunRoutes: Record<string, Response> = {};
  for (const pattern of patterns) {
    bunRoutes[pattern] = new Response(pattern);
  }
  const server = Bun.serve({
    port: 0,
    routes: bunRoutes,
    fetch: () => new Response('', { status: 404 }),
  });
  try {
    for (const pathname of [
      '/bar/foo/z',
      '/a/b/c',
      '/x/b/c',
      '/a/x/c',
      '/k/k/k/z',
      '/m/m/n/o',
      '/q/m/n/o',
      '/clients/aeronet',
      '/clients/aeronet/proposals/quoting-system',
      '/clients/aeronet/proposals/quoting-system/manage',
      '/clients/aeronet/proposals/quoting-system/v5',
      '/clients/aeronet/proposals/quoting-system/v5/x',
      '/clients/aeronet/proposals/quoting.system',
      '/clients/aeronet.json',
      '/download.json',
      '/a/b/c.txt',
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.port}${pathname}`);
      const served = response.status === 200 ? await response.text() : undefined;
      expect(matchPageRoute(routes, pathname)?.route.pattern).toBe(served);
    }
  } finally {
    server.stop(true);
  }
});

test('assertPageRoutesCompatible refuses a view that would shadow another page', () => {
  const pages = [
    { name: 'home', routePath: '/' },
    { name: 'about', routePath: '/about' },
    { name: 'zzz', routePath: '/zzz' },
  ];
  const declare = (views: Array<{ path: string; page: string }>) =>
    assertPageRoutesCompatible(normalizePageRoutes(views), pages);

  expect(() => declare([{ path: '/about', page: 'zzz' }])).toThrow(
    'view path /about for page "zzz" is already the address of page "about"',
  );
  expect(() => declare([{ path: '/about/', page: 'zzz' }])).toThrow('already the address');
  expect(() => declare([{ path: '/home', page: 'zzz' }])).toThrow('already the address');
  // A file-name pattern is refused before the shadow check gets to it.
  expect(() => declare([{ path: '/about/index.html', page: 'zzz' }])).toThrow(
    'ends in a file name',
  );
  expect(() => declare([{ path: '/things/:thing', page: 'missing' }])).toThrow('does not exist');

  expect(() => declare([{ path: '/about', page: 'about' }])).not.toThrow();
  expect(() => declare([{ path: '/things/:thing', page: 'zzz' }])).not.toThrow();
  expect(() => declare([{ path: '/about/:section', page: 'zzz' }])).not.toThrow();
});
