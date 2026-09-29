import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareApp } from '../dist/index.js';
import {
  FileExistsError,
  FileTooLargeError,
  files,
  serveLocalFile,
  setFileStore,
} from '../dist/files/index.js';

const KEYS = [
  'STORAGE_URL',
  'SESSION_SECRET',
  'WEBSTIR_WORKSPACE_ROOT',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_REGION',
  'S3_PROFILE',
  'S3_TIMEOUT_MS',
  'AWS_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
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

test('s3:// keeps files in a bucket, under its prefix, through the AWS SDK', async () => {
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

// A store that accepts a request and never answers must not hold the app (or a snapshot) up.
test('an S3 request that never answers fails after S3_TIMEOUT_MS', async () => {
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch() {
      requests += 1;
      return new Promise(() => {});
    },
  });
  try {
    await withApp(
      {
        STORAGE_URL: 's3://uploads',
        S3_ENDPOINT: `http://127.0.0.1:${server.port}`,
        S3_ACCESS_KEY_ID: 'test',
        S3_SECRET_ACCESS_KEY: 'test',
        S3_REGION: 'us-east-1',
        S3_TIMEOUT_MS: '200',
      },
      async () => {
        const started = Date.now();
        await assert.rejects(files.get('a.txt'));
        assert.ok(Date.now() - started < 10_000, `gave up after ${Date.now() - started}ms`);
        assert.ok(requests >= 1);
      },
    );
  } finally {
    server.stop(true);
  }
}, 20_000);

// An app whose other AWS calls, such as email, use AWS_PROFILE gives storage its own.
test('S3_PROFILE picks the profile storage signs with, over AWS_PROFILE', async () => {
  const signedWith = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      signedWith.push(/Credential=([^/]+)\//.exec(request.headers.get('authorization') ?? '')?.[1]);
      return new Response(null, { status: 200, headers: { etag: '"1"' } });
    },
  });
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-profiles-'));
  const credentials = path.join(folder, 'credentials');
  await fs.writeFile(
    credentials,
    [
      '[email]',
      'aws_access_key_id = EMAILKEY',
      'aws_secret_access_key = email-secret',
      '[storage]',
      'aws_access_key_id = STORAGEKEY',
      'aws_secret_access_key = storage-secret',
      '',
    ].join('\n'),
  );
  try {
    await withApp(
      {
        STORAGE_URL: 's3://uploads',
        S3_ENDPOINT: `http://127.0.0.1:${server.port}`,
        S3_REGION: 'us-east-1',
        AWS_SHARED_CREDENTIALS_FILE: credentials,
        AWS_CONFIG_FILE: path.join(folder, 'config'),
        AWS_PROFILE: 'email',
        S3_PROFILE: 'storage',
      },
      async () => {
        await files.put('a.txt', 'a');
        assert.deepEqual(signedWith, ['STORAGEKEY']);
      },
    );
  } finally {
    server.stop(true);
    await fs.rm(folder, { recursive: true, force: true });
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
    for (const key of [
      'reports/报告.zip',
      'reports/two words "quoted".bin',
      "reports/Ada's (final)*.zip",
    ]) {
      await files.put(key, 'x', { contentType: 'application/zip' });
      const served = await serveLocalFile(new URL(await files.url(key), 'http://app.test'));
      assert.equal(served.status, 200, key);
      const disposition = served.headers.get('content-disposition') ?? '';
      assert.match(disposition, /^attachment; filename="[\x20-\x7e]*"; filename\*=UTF-8''/, key);
      const encoded = /filename\*=UTF-8''(.*)$/.exec(disposition)?.[1] ?? '';
      assert.match(encoded, /^[A-Za-z0-9!#$&+.^_`|~%-]+$/, key);
      assert.equal(decodeURIComponent(encoded), key.split('/').at(-1), key);
    }
    const entries = await fs.readdir(path.join(root, 'data'));
    assert.deepEqual(entries, ['files']);
    for (const key of ['.webstir/types/x', '.WEBSTIR/types/x', '.Webstir/x']) {
      await assert.rejects(files.put(key, 'x'), /is not a file key/, key);
    }
  });
});

test("setFileStore keeps files with the app's own store, under the same key rule", async () => {
  await withApp({ STORAGE_URL: 's3://not-used' }, async () => {
    const kept = new Map();
    const calls = [];
    setFileStore({
      async put(key, data, options) {
        calls.push(['put', key, options]);
        kept.set(key, new Blob([data], { type: options?.contentType }));
      },
      async get(key) {
        calls.push(['get', key]);
        return kept.get(key);
      },
      async url(key, options) {
        calls.push(['url', key, options]);
        return `https://files.example/${key}?expires=${options.expiresIn}`;
      },
      async delete(key) {
        calls.push(['delete', key]);
        kept.delete(key);
      },
    });
    try {
      await files.put('proposals/a.pdf', new Blob(['%PDF'], { type: 'application/pdf' }));
      assert.equal(await (await files.get('proposals/a.pdf'))?.text(), '%PDF');
      assert.equal(
        await files.url('proposals/a.pdf', { expiresIn: 90.5 }),
        'https://files.example/proposals/a.pdf?expires=90',
      );
      await files.delete('proposals/a.pdf');
      assert.equal(await files.get('proposals/a.pdf'), undefined);
      await files.put('proposals/b.pdf', new Uint8Array([37, 80]));
      await files.put('proposals/c', 'no extension');
      assert.deepEqual(calls, [
        ['put', 'proposals/a.pdf', { contentType: 'application/pdf' }],
        ['get', 'proposals/a.pdf'],
        ['url', 'proposals/a.pdf', { expiresIn: 90 }],
        ['delete', 'proposals/a.pdf'],
        ['get', 'proposals/a.pdf'],
        ['put', 'proposals/b.pdf', { contentType: 'application/pdf' }],
        ['put', 'proposals/c', undefined],
      ]);

      for (const key of ['../x', '/x', 'a//b']) {
        await assert.rejects(files.put(key, 'x'), /not a file key/);
        await assert.rejects(files.get(key), /not a file key/);
      }
      assert.equal(calls.length, 7);
      assert.equal(
        (await serveLocalFile(new URL('http://app/api/_webstir/files/proposals/a.pdf')))?.status,
        404,
      );
    } finally {
      setFileStore(undefined);
    }
  });
});

/** A stand-in S3: objects by path, with the conditional write and metadata S3 has. */
function fakeS3() {
  const objects = new Map();
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const key = decodeURIComponent(new URL(request.url).pathname);
      if (request.method === 'PUT') {
        if (request.headers.get('if-none-match') === '*' && objects.has(key)) {
          return new Response('<Error><Code>PreconditionFailed</Code></Error>', { status: 412 });
        }
        const metadata = Object.fromEntries(
          [...request.headers].filter(([name]) => name.startsWith('x-amz-meta-')),
        );
        objects.set(key, { body: new Uint8Array(await request.arrayBuffer()), metadata });
        return new Response(null, { status: 200, headers: { etag: '"1"' } });
      }
      if (request.method === 'DELETE') {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      const object = objects.get(key);
      if (!object) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : object.body, {
        headers: {
          'content-length': String(object.body.length),
          etag: '"1"',
          ...object.metadata,
        },
      });
    },
  });
  return {
    env: {
      STORAGE_URL: 's3://uploads/app',
      S3_ENDPOINT: `http://127.0.0.1:${server.port}`,
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
      S3_REGION: 'us-east-1',
    },
    stop: () => server.stop(true),
  };
}

// Private documents need writes that never replace one, metadata kept with each, and reads that
// refuse a file too large to load: on disk and in S3 alike.
for (const store of ['local disk', 'S3']) {
  test(`${store}: a write-once put, metadata, and a read bounded by size`, async () => {
    const s3 = store === 'S3' ? fakeS3() : undefined;
    try {
      await withApp(s3?.env ?? {}, async () => {
        await files.put('docs/one.json', '{"v":1}', {
          ifAbsent: true,
          metadata: { 'uploaded-by': 'ada' },
        });
        await assert.rejects(
          files.put('docs/one.json', '{"v":2}', { ifAbsent: true }),
          (error) => error instanceof FileExistsError && error.key === 'docs/one.json',
        );
        const kept = await files.get('docs/one.json');
        assert.equal(await kept.text(), '{"v":1}', 'the first write stays');
        assert.deepEqual({ ...kept.metadata }, { 'uploaded-by': 'ada' });

        assert.equal(await (await files.get('docs/one.json', { maxBytes: 7 })).text(), '{"v":1}');
        await assert.rejects(
          files.get('docs/one.json', { maxBytes: 6 }),
          (error) => error instanceof FileTooLargeError && error.maxBytes === 6,
        );

        // Without ifAbsent a put replaces the file, and its metadata with it.
        await files.put('docs/one.json', '{"v":3}');
        const replaced = await files.get('docs/one.json');
        assert.equal(await replaced.text(), '{"v":3}');
        assert.deepEqual({ ...replaced.metadata }, {});
        await files.delete('docs/one.json');
        assert.equal(await files.get('docs/one.json'), undefined);
      });
    } finally {
      s3?.stop();
    }
  });
}
