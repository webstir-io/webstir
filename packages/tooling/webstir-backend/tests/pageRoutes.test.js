import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { matchPageRoute, normalizePageRoutes, readWorkspacePageRoutes } from '../dist/index.js';
import { servePublishedStaticFile } from '../dist/runtime/deploy-static.js';

const portalViews = [
  { name: 'client', path: '/clients/:client', page: 'client', renderMode: 'spa' },
  { name: 'proposals', path: '/clients/:client/proposals', page: 'proposals' },
  { name: 'proposal', path: '/clients/:client/proposals/:proposal', page: 'proposal' },
  { name: 'version', path: '/clients/:client/proposals/:proposal/:version', page: 'proposal' },
  { name: 'record', path: '/clients/:client/proposals/:proposal/manage', page: 'proposal-viewer' },
];

test('normalizePageRoutes keeps page views and orders static segments first', () => {
  const routes = normalizePageRoutes([
    ...portalViews,
    { name: 'backend-only', path: '/reports/:id', renderMode: 'ssr' },
    { name: 'ssg', path: '/docs/:slug', page: 'docs', renderMode: 'ssg' },
    null,
    'junk',
  ]);
  assert.deepEqual(
    routes.map((route) => route.pattern),
    [
      '/clients/:client',
      '/clients/:client/proposals',
      '/clients/:client/proposals/:proposal',
      '/clients/:client/proposals/:proposal/manage',
      '/clients/:client/proposals/:proposal/:version',
    ],
  );
  assert.equal(routes[3].page, 'proposal-viewer');
  assert.equal(routes[3].name, 'record');
});

test('matchPageRoute prefers a static segment over a parameter and decodes params', () => {
  const routes = normalizePageRoutes(portalViews);
  const manage = matchPageRoute(routes, '/clients/aeronet/proposals/quoting-system/manage');
  assert.equal(manage?.route.page, 'proposal-viewer');
  assert.deepEqual(manage?.params, { client: 'aeronet', proposal: 'quoting-system' });

  const version = matchPageRoute(routes, '/clients/aeronet/proposals/quoting-system/v5/');
  assert.equal(version?.route.page, 'proposal');
  assert.equal(version?.params.version, 'v5');

  const encoded = matchPageRoute(routes, '/clients/a%20b/proposals/q');
  assert.equal(encoded?.params.client, 'a b');

  assert.equal(matchPageRoute(routes, '/clients'), undefined);
  assert.equal(matchPageRoute(routes, '/clients/aeronet/proposals/q/v5/extra'), undefined);
  assert.equal(matchPageRoute(routes, '/clients/../proposals/q'), undefined);
  assert.equal(matchPageRoute(routes, '/clients/%E0%A4%A/proposals/q'), undefined);
});

test('matchPageRoute ranks overlapping patterns the way Bun.serve does', () => {
  // Expected winners were recorded from Bun.serve with the same route table.
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
    '/:x/:y/k/:z',
    '/m/:x/n/:y',
    '/m/:x/:y/o',
    '/:x/m/n/:y',
  ];
  const routes = normalizePageRoutes(
    patterns.map((pattern, index) => ({ path: pattern, page: `p${index}` })),
  );
  const winners = {
    '/bar/foo/z': '/bar/:y/:z',
    '/a/b/c': '/a/b/:y',
    '/x/b/c': '/:x/b/c',
    '/a/x/c': '/a/:x/c',
    '/k/k/k/z': '/k/:x/:y/:z',
    '/m/m/n/o': '/m/:x/n/:y',
    '/q/m/n/o': '/:x/m/n/:y',
  };
  for (const [pathname, expected] of Object.entries(winners)) {
    assert.equal(matchPageRoute(routes, pathname)?.route.pattern, expected, pathname);
  }
});

test('normalizePageRoutes rejects malformed declarations', () => {
  assert.throws(
    () => normalizePageRoutes([{ path: 'clients/:client', page: 'client' }]),
    /must start with/,
  );
  assert.throws(() => normalizePageRoutes([{ path: '/', page: 'home' }]), /cannot route to a page/);
  assert.throws(
    () => normalizePageRoutes([{ path: '/p/:proposal/v:version', page: 'proposal' }]),
    /invalid segment "v:version"/,
  );
  assert.throws(
    () => normalizePageRoutes([{ path: '/p/:a/:a', page: 'proposal' }]),
    /repeats the parameter/,
  );
  assert.throws(
    () => normalizePageRoutes([{ path: '/download.json', page: 'files' }]),
    /ends in a file name/,
  );
  assert.throws(
    () => normalizePageRoutes([{ path: '/files/report.pdf', page: 'files' }]),
    /ends in a file name/,
  );
  assert.equal(normalizePageRoutes([{ path: '/v1.2/:id', page: 'files' }]).length, 1);
  assert.throws(() => normalizePageRoutes([{ page: 'proposal' }]), /needs a "path"/);
  assert.throws(() => normalizePageRoutes([{ path: '/p/:a', page: '' }]), /non-empty page name/);
  assert.throws(
    () =>
      normalizePageRoutes([
        { path: '/p/:a', page: 'one' },
        { path: '/p/:b', page: 'two' },
      ]),
    /declared by both "one" and "two"/,
  );
  assert.deepEqual(
    normalizePageRoutes([
      { path: '/p/:a', page: 'one' },
      { path: '/p/:a/', page: 'one' },
    ]).length,
    2,
  );
});

test('readWorkspacePageRoutes reads webstir.moduleManifest.views from package.json', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-page-routes-'));
  try {
    await fs.writeFile(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        name: 'demo',
        webstir: { mode: 'full', moduleManifest: { views: portalViews } },
      }),
    );
    const routes = await readWorkspacePageRoutes(workspace);
    assert.equal(routes.length, 5);

    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: 'demo' }));
    assert.deepEqual(await readWorkspacePageRoutes(workspace), []);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('servePublishedStaticFile serves page routes after static files and an HTML 404', async () => {
  const frontendRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-page-routes-static-'));
  try {
    for (const [page, body] of [
      ['clients', '<h1>clients</h1>'],
      ['proposal', '<h1>proposal</h1>'],
      ['404', '<h1>missing</h1>'],
    ]) {
      await fs.mkdir(path.join(frontendRoot, 'pages', page), { recursive: true });
      await fs.writeFile(path.join(frontendRoot, 'pages', page, 'index.html'), body);
    }
    const pageRoutes = normalizePageRoutes(portalViews);
    const serve = (requestPath, init) =>
      servePublishedStaticFile(new Request(`http://localhost${requestPath}`, init), frontendRoot, {
        pageRoutes,
      });

    const list = await serve('/clients/');
    assert.equal(list.status, 200);
    assert.equal(await list.text(), '<h1>clients</h1>');

    const reader = await serve('/clients/aeronet/proposals/quoting-system');
    assert.equal(reader.status, 200);
    assert.equal(reader.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await reader.text(), '<h1>proposal</h1>');

    const head = await serve('/clients/aeronet/proposals/quoting-system/v5', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');

    const unknownPage = await serve('/clients/aeronet');
    assert.equal(unknownPage.status, 404);

    // A parameter accepts a dotted value, as Bun's router does in watch.
    const dotted = await serve('/clients/aeronet/proposals/quoting.system');
    assert.equal(dotted.status, 200);
    assert.equal(await dotted.text(), '<h1>proposal</h1>');

    const asset = await serve('/assets/app.js');
    assert.equal(asset.status, 404);
    assert.equal(asset.headers.get('content-type'), 'text/plain; charset=utf-8');

    const htmlMiss = await serve('/nowhere', { headers: { accept: 'text/html,*/*' } });
    assert.equal(htmlMiss.status, 404);
    assert.equal(htmlMiss.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await htmlMiss.text(), '<h1>missing</h1>');

    const plainMiss = await serve('/nowhere');
    assert.equal(plainMiss.status, 404);
    assert.equal(plainMiss.headers.get('content-type'), 'text/plain; charset=utf-8');

    const withoutRoutes = await servePublishedStaticFile(
      new Request('http://localhost/clients/aeronet/proposals/quoting-system'),
      frontendRoot,
    );
    assert.equal(withoutRoutes.status, 404);
  } finally {
    await fs.rm(frontendRoot, { recursive: true, force: true });
  }
});
