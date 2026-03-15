import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { DevServer, getApiProxyPath, getStaticCandidatePaths } from '../src/dev-server.ts';

test('getStaticCandidatePaths rewrites root assets and page routes for SPA development', () => {
  expect(getStaticCandidatePaths('/')).toEqual(['pages/home/index.html']);
  expect(getStaticCandidatePaths('/index.css')).toEqual(['index.css', 'pages/home/index.css']);
  expect(getStaticCandidatePaths('/home')).toEqual(['home', 'home.html', 'home/index.html', 'pages/home/index.html']);
  expect(getStaticCandidatePaths('/home/index.js')).toEqual(['home/index.js', 'pages/home/index.js']);
  expect(getStaticCandidatePaths('/refresh.js')).toEqual(['refresh.js']);
});

test('getApiProxyPath strips the /api prefix for backend proxying', () => {
  expect(getApiProxyPath('/api')).toBe('/');
  expect(getApiProxyPath('/api/health')).toBe('/health');
  expect(getApiProxyPath('/api//health')).toBe('/health');
  expect(getApiProxyPath('/api/../health')).toBe('/health');
  expect(getApiProxyPath('/api/v1/items')).toBe('/v1/items');
  expect(getApiProxyPath('/home')).toBeNull();
});

test('DevServer serves static files with the expected cache headers', async () => {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-dev-server-static-'));
  const server = new DevServer({ buildRoot, host: '127.0.0.1', port: 0 });

  try {
    await mkdir(path.join(buildRoot, 'pages', 'home'), { recursive: true });
    await mkdir(path.join(buildRoot, 'assets'), { recursive: true });
    await Promise.all([
      writeFile(path.join(buildRoot, 'pages', 'home', 'index.html'), '<h1>Home</h1>', 'utf8'),
      writeFile(path.join(buildRoot, 'refresh.js'), 'console.log("refresh");', 'utf8'),
      writeFile(path.join(buildRoot, 'assets', 'app.12345678.js'), 'console.log("asset");', 'utf8'),
    ]);

    const address = await server.start();

    const homeResponse = await fetch(`${address.origin}/`);
    expect(homeResponse.status).toBe(200);
    expect(homeResponse.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(homeResponse.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate');
    expect(homeResponse.headers.get('pragma')).toBe('no-cache');
    expect(homeResponse.headers.get('expires')).toBe('0');
    expect(await homeResponse.text()).toBe('<h1>Home</h1>');

    const refreshResponse = await fetch(`${address.origin}/refresh.js`);
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate');
    expect(refreshResponse.headers.get('pragma')).toBe('no-cache');
    expect(refreshResponse.headers.get('expires')).toBe('0');

    const assetHeadResponse = await fetch(`${address.origin}/assets/app.12345678.js`, {
      method: 'HEAD',
    });
    expect(assetHeadResponse.status).toBe(200);
    expect(assetHeadResponse.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await assetHeadResponse.text()).toBe('');
  } finally {
    await server.stop();
    await rm(buildRoot, { recursive: true, force: true });
  }
});

test('DevServer proxies API requests and rewrites same-origin redirects', async () => {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-dev-server-proxy-'));
  const upstream = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/echo') {
        return new Response(await request.text(), {
          headers: {
            'x-upstream-method': request.method,
          },
        });
      }

      return new Response(`${request.method} ${url.pathname}${url.search}`, {
        status: 302,
        headers: {
          location: '/login',
          'x-upstream-method': request.method,
        },
      });
    },
  });
  const server = new DevServer({
    buildRoot,
    host: '127.0.0.1',
    port: 0,
    apiProxyOrigin: upstream.url.origin,
  });

  try {
    const address = await server.start();
    const redirectResponse = await fetch(`${address.origin}/api/session?via=test`, {
      redirect: 'manual',
    });

    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get('location')).toBe('/api/login');
    expect(redirectResponse.headers.get('x-upstream-method')).toBe('GET');
    expect(await redirectResponse.text()).toBe('GET /session?via=test');

    const response = await fetch(`${address.origin}/api/echo`, {
      method: 'POST',
      body: 'payload',
      headers: {
        'content-type': 'text/plain',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-upstream-method')).toBe('POST');
    expect(await response.text()).toBe('payload');
  } finally {
    await server.stop();
    upstream.stop(true);
    await rm(buildRoot, { recursive: true, force: true });
  }
});

test('DevServer streams SSE updates and closes clients on shutdown', async () => {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-dev-server-sse-'));
  const server = new DevServer({ buildRoot, host: '127.0.0.1', port: 0 });

  try {
    const address = await server.start();
    const response = await fetch(`${address.origin}/sse`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const textPromise = readStream(reader!);

    await server.publishStatus('idle');
    await server.publishHotUpdate({
      requiresReload: false,
      modules: [],
      styles: [],
    });
    await server.publishReload();
    await server.stop();

    const text = await textPromise;
    expect(text).toContain('data: shutdown\n\n');
    expect(text).toContain('event: status\ndata: idle\n\n');
    expect(text).toContain('event: hmr\ndata: {"requiresReload":false,"modules":[],"styles":[]}\n\n');
    expect(text).toContain('data: reload\n\n');
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
});

async function readStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    text += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    if (done) {
      break;
    }
  }

  return text;
}
