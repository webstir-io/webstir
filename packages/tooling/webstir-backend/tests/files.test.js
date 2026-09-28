import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import { files, serveLocalFile } from '../dist/files/index.js';

const KEYS = [
  'STORAGE_URL',
  'SESSION_SECRET',
  'WEBSTIR_WORKSPACE_ROOT',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_REGION',
];

async function withApp(values, run) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, { SESSION_SECRET: 'files-test-secret', ...values });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-files-'));
  prepareApp(root);
  try {
    await run(root);
  } finally {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('local files: put, get, a signed link the server serves, delete', async () => {
  await withApp({}, async (root) => {
    await files.put('avatars/ada.txt', 'Ada');
    assert.equal(
      await fs.readFile(path.join(root, 'data', 'files', 'avatars', 'ada.txt'), 'utf8'),
      'Ada',
    );
    assert.equal(await (await files.get('avatars/ada.txt')).text(), 'Ada');
    assert.equal(await files.get('avatars/nobody.txt'), undefined);

    const link = new URL(await files.url('avatars/ada.txt', { expiresIn: 60 }), 'http://app.test');
    assert.equal(link.pathname, '/api/_webstir/files/avatars/ada.txt');
    const served = await serveLocalFile(link);
    assert.equal(served.status, 200);
    assert.equal(await served.text(), 'Ada');

    for (const [name, change] of [
      ['a tampered signature', (url) => url.searchParams.set('signature', 'x'.repeat(43))],
      ['another file', (url) => (url.pathname = '/api/_webstir/files/avatars/grace.txt')],
      [
        'an expired link',
        (url) => url.searchParams.set('expires', String(Math.floor(Date.now() / 1000) - 1)),
      ],
    ]) {
      const other = new URL(link);
      change(other);
      assert.equal((await serveLocalFile(other)).status, 403, name);
    }
    assert.equal(await serveLocalFile(new URL('http://app.test/api/other')), undefined);

    await files.delete('avatars/ada.txt');
    assert.equal(await files.get('avatars/ada.txt'), undefined);
  });
});

test('a key is a relative path of plain segments', async () => {
  await withApp({}, async () => {
    for (const key of ['../secret', '/etc/passwd', 'a//b', 'a/./b', 'a\\b', '']) {
      await assert.rejects(files.put(key, 'x'), /is not a file key/, JSON.stringify(key));
    }
  });
});

test("s3:// keeps files in a bucket, under its prefix, through Bun's S3 client", async () => {
  const objects = new Map();
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const key = decodeURIComponent(new URL(request.url).pathname);
      if (request.method === 'PUT') {
        objects.set(key, new Uint8Array(await request.arrayBuffer()));
        return new Response(null, { status: 200, headers: { etag: '"1"' } });
      }
      if (request.method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      const body = objects.get(key);
      if (!body) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : body, {
        headers: { 'content-length': String(body.length), etag: '"1"' },
      });
    },
  });
  try {
    await withApp(
      {
        STORAGE_URL: 's3://uploads/app',
        S3_ENDPOINT: `http://127.0.0.1:${server.port}`,
        S3_ACCESS_KEY_ID: 'test',
        S3_SECRET_ACCESS_KEY: 'test',
        S3_REGION: 'us-east-1',
      },
      async () => {
        await files.put('avatars/ada.txt', 'Ada');
        assert.ok(objects.has('/uploads/app/avatars/ada.txt'), [...objects.keys()].join(', '));
        assert.equal(await (await files.get('avatars/ada.txt')).text(), 'Ada');
        assert.equal(await files.get('avatars/nobody.txt'), undefined);
        assert.match(
          await files.url('avatars/ada.txt'),
          /\/uploads\/app\/avatars\/ada\.txt\?.*X-Amz-Signature=/,
        );
        await files.delete('avatars/ada.txt');
        assert.equal(objects.size, 0);
      },
    );
  } finally {
    server.stop(true);
  }
});

test('local files keep their media type, and anything that could run script is a sandboxed download', async () => {
  await withApp({}, async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const cases = [
      {
        key: 'photos/1',
        data: new Blob([png], { type: 'image/png' }),
        type: 'image/png',
        inline: true,
      },
      {
        key: 'docs/2',
        data: 'hello',
        options: { contentType: 'text/plain' },
        type: 'text/plain',
        inline: true,
      },
      {
        key: 'pages/evil.html',
        data: '<script>alert(1)</script>',
        type: 'text/html',
        inline: false,
      },
      {
        key: 'art/evil.svg',
        data: '<svg onload="alert(1)"/>',
        type: 'image/svg+xml',
        inline: false,
      },
      { key: 'blobs/x', data: 'x', type: 'application/octet-stream', inline: false },
    ];
    for (const entry of cases) {
      await files.put(entry.key, entry.data, entry.options);
      assert.match(
        (await files.get(entry.key)).type,
        new RegExp(`^${entry.type.replace('+', '\\+')}`),
        entry.key,
      );
      const served = await serveLocalFile(new URL(await files.url(entry.key), 'http://app.test'));
      assert.match(
        served.headers.get('content-type') ?? '',
        new RegExp(`^${entry.type.replace('+', '\\+')}`),
        entry.key,
      );
      assert.match(served.headers.get('content-security-policy') ?? '', /sandbox/, entry.key);
      assert.equal(
        (served.headers.get('content-disposition') ?? '').startsWith('attachment'),
        !entry.inline,
        entry.key,
      );
    }
    await files.delete('photos/1');
    assert.equal(await files.get('photos/1'), undefined);
  });
});

test('downloads keep names in any script, and type records stay inside the storage folder', async () => {
  await withApp({}, async (root) => {
    for (const key of ['reports/报告.zip', 'reports/two words "quoted".bin']) {
      await files.put(key, 'x', { contentType: 'application/zip' });
      const served = await serveLocalFile(new URL(await files.url(key), 'http://app.test'));
      assert.equal(served.status, 200, key);
      const disposition = served.headers.get('content-disposition') ?? '';
      assert.match(disposition, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/, key);
      assert.ok(disposition.includes(encodeURIComponent(key.split('/').at(-1))), key);
    }
    const entries = await fs.readdir(path.join(root, 'data'));
    assert.deepEqual(entries, ['files']);
    await assert.rejects(files.put('.webstir/types/x', 'x'), /is not a file key/);
  });
});
