import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { appUrl, loadAppEnv, parseEnvFile } from '../dist/app/env.js';

const KEYS = [
  'NODE_ENV',
  'PORT',
  'SESSION_SECRET',
  'SESSION_COOKIE_SECURE',
  'SESSION_MAX_AGE',
  'APP_URL',
  'FROM_LOCAL',
  'FROM_BOTH',
];

async function withEnv(values, run) {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, values);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-env-'));
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

test('.env files: .env.local wins over .env, and the shell wins over both', async () => {
  await withEnv({ PORT: '5000' }, async (root) => {
    await fs.writeFile(path.join(root, '.env'), 'PORT=6000\nFROM_BOTH=env\nSESSION_MAX_AGE=60\n');
    await fs.writeFile(
      path.join(root, '.env.local'),
      'FROM_LOCAL="local value"\nFROM_BOTH=local\n',
    );
    const env = loadAppEnv(root);
    assert.equal(env.PORT, 5000);
    assert.equal(env.sessions.maxAgeSeconds, 60);
    assert.equal(process.env.FROM_LOCAL, 'local value');
    assert.equal(process.env.FROM_BOTH, 'local');
  });
});

test('.env lines: comments, export, quotes', () => {
  assert.deepEqual(
    parseEnvFile(
      `# comment\nexport A=1\nB = "two # kept"\nC='three'\nD=four # dropped\n\nnot a line\n`,
    ),
    [
      ['A', '1'],
      ['B', 'two # kept'],
      ['C', 'three'],
      ['D', 'four'],
    ],
  );
});

test('development makes a session secret once and keeps it; production requires one', async () => {
  await withEnv({}, async (root) => {
    const first = loadAppEnv(root);
    assert.equal(first.PORT, 4321);
    assert.equal(first.sessions.secure, false);
    assert.match(first.sessions.secret, /^[0-9a-f]{64}$/);
    assert.equal(loadAppEnv(root).sessions.secret, first.sessions.secret);
  });
  await withEnv({ NODE_ENV: 'production' }, async (root) => {
    assert.throws(() => loadAppEnv(root), /SESSION_SECRET is required in production/);
    process.env.SESSION_SECRET = 'a-long-production-secret';
    const env = loadAppEnv(root);
    assert.equal(env.sessions.secret, 'a-long-production-secret');
    assert.equal(env.sessions.secure, true);
  });
  await withEnv({ SESSION_MAX_AGE: 'soon' }, async (root) => {
    assert.throws(() => loadAppEnv(root), /SESSION_MAX_AGE is "soon"; expected a positive number/);
  });
});

test('the app address: APP_URL, else what the request says, and production requires APP_URL', async () => {
  await withEnv({}, async () => {
    const request = new Request('http://127.0.0.1:4999/sign-in', {
      headers: { 'x-forwarded-host': 'localhost:8088', 'x-forwarded-proto': 'http' },
    });
    assert.equal(appUrl(request), 'http://localhost:8088');
    process.env.APP_URL = 'https://example.com/';
    assert.equal(appUrl(request), 'https://example.com');
  });
  await withEnv({ NODE_ENV: 'production' }, async () => {
    assert.throws(
      () => appUrl(new Request('http://evil.test/')),
      /APP_URL is required in production/,
    );
  });
});
