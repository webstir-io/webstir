import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterTemplate = path.join(packageRoot, 'templates', 'backend', 'auth', 'adapter.ts');

async function importAuthAdapter() {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-auth-adapter-'));
  const outfile = path.join(workspace, 'adapter.mjs');
  await esbuild({
    entryPoints: [adapterTemplate],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  });
  return await import(`${pathToFileURL(outfile).href}?t=${Date.now()}-${Math.random()}`);
}

function defaultSecrets(overrides = {}) {
  return {
    jwtSecret: 'jwt-secret',
    jwtPublicKey: undefined,
    jwksUrl: undefined,
    jwtIssuer: 'https://issuer.example.com/',
    jwtAudience: 'webstir-tests',
    serviceTokens: [],
    ...overrides,
  };
}

function makeRequest(headers) {
  return new Request('http://webstir.test/auth', { headers });
}

async function resolveBearer(resolveRequestAuth, token, secrets, logger) {
  return await resolveRequestAuth(
    makeRequest({ authorization: `Bearer ${token}` }),
    secrets,
    logger,
  );
}

function signJwtToken(payload, key, options = {}) {
  const encodedHeader = encodeJwtSegment({
    alg: options.alg ?? 'HS256',
    typ: 'JWT',
    ...(options.kid ? { kid: options.kid } : {}),
  });
  const encodedPayload = encodeJwtSegment(payload);
  return signJwtSegments(encodedHeader, encodedPayload, key, options);
}

function signJwtSegments(encodedHeader, encodedPayload, key, options = {}) {
  const alg = options.alg ?? 'HS256';
  const signedContent = `${encodedHeader}.${encodedPayload}`;
  const signature =
    alg === 'HS256'
      ? crypto.createHmac('sha256', key).update(signedContent).digest('base64url')
      : crypto.sign('RSA-SHA256', Buffer.from(signedContent), key).toString('base64url');
  return `${signedContent}.${signature}`;
}

function encodeJwtSegment(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function validPayload(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'user-123',
    iss: 'https://issuer.example.com/',
    aud: 'webstir-tests',
    nbf: now - 60,
    exp: now + 60,
    ...overrides,
  };
}

function publicJwk(keyPair, kid) {
  return {
    ...keyPair.publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
    use: 'sig',
  };
}

async function startJwksServer(handler) {
  const server = http.createServer((req, res) => {
    if ((req.url ?? '/') !== '/.well-known/jwks.json') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    handler(req, res);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to read JWKS test server address.');
  }

  return {
    url: `http://127.0.0.1:${address.port}/.well-known/jwks.json`,
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test('auth adapter fails closed for invalid jwt algorithms, claims, and signatures', async () => {
  const { resolveRequestAuth } = await importAuthAdapter();
  const secret = 'jwt-secret';
  const secrets = defaultSecrets({ jwtSecret: secret });
  const unsupportedAlgToken = signJwtSegments(
    encodeJwtSegment({ alg: 'HS512', typ: 'JWT' }),
    encodeJwtSegment(validPayload()),
    secret,
  );

  const cases = [
    unsupportedAlgToken,
    signJwtToken(validPayload({ iss: 'https://wrong.example.com/' }), secret),
    signJwtToken(validPayload({ aud: 'wrong-audience' }), secret),
    signJwtToken(validPayload({ aud: ['other-audience'] }), secret),
    signJwtToken(validPayload({ exp: 'not-a-number' }), secret),
    signJwtToken(validPayload({ nbf: 'not-a-number' }), secret),
    signJwtToken(validPayload({ iat: 'not-a-number' }), secret),
    signJwtToken(validPayload(), 'wrong-secret'),
    `${encodeJwtSegment({ alg: 'HS256', typ: 'JWT' })}.${encodeJwtSegment(validPayload())}.`,
  ];

  for (const token of cases) {
    assert.equal(await resolveBearer(resolveRequestAuth, token, secrets), undefined);
  }
});

test('auth adapter rejects malformed compact jwt segments before verification', async () => {
  const { resolveRequestAuth } = await importAuthAdapter();
  const secret = 'jwt-secret';
  const secrets = defaultSecrets({ jwtSecret: secret });

  const malformedHeader = `${encodeJwtSegment({ alg: 'HS256', typ: 'JWT' })}@`;
  const validPayloadSegment = encodeJwtSegment(validPayload());
  const signedMalformedHeaderToken = signJwtSegments(malformedHeader, validPayloadSegment, secret);
  const malformedJsonPayload = signJwtSegments(
    encodeJwtSegment({ alg: 'HS256', typ: 'JWT' }),
    Buffer.from('not-json').toString('base64url'),
    secret,
  );

  assert.equal(
    await resolveBearer(resolveRequestAuth, signedMalformedHeaderToken, secrets),
    undefined,
  );
  assert.equal(await resolveBearer(resolveRequestAuth, malformedJsonPayload, secrets), undefined);
  assert.equal(await resolveBearer(resolveRequestAuth, 'not-a-jwt', secrets), undefined);
});

test('auth adapter refreshes jwks on unknown kid without accepting wrong keys', async () => {
  const { resolveRequestAuth } = await importAuthAdapter();
  const firstKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const refreshedKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  let requests = 0;

  const jwks = await startJwksServer((_req, res) => {
    requests += 1;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'public, max-age=60');
    const keys =
      requests === 1
        ? [publicJwk(firstKeyPair, 'initial-key')]
        : [publicJwk(firstKeyPair, 'initial-key'), publicJwk(refreshedKeyPair, 'refreshed-key')];
    res.end(JSON.stringify({ keys }));
  });

  try {
    const secrets = defaultSecrets({
      jwtSecret: undefined,
      jwksUrl: jwks.url,
    });
    const refreshedToken = signJwtToken(
      validPayload({ sub: 'refreshed-user' }),
      refreshedKeyPair.privateKey,
      { alg: 'RS256', kid: 'refreshed-key' },
    );
    const context = await resolveBearer(resolveRequestAuth, refreshedToken, secrets);

    assert.equal(context?.source, 'jwt');
    assert.equal(context?.userId, 'refreshed-user');
    assert.equal(requests, 2);

    const wrongKeyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const wrongKidToken = signJwtToken(validPayload(), wrongKeyPair.privateKey, {
      alg: 'RS256',
      kid: 'missing-key',
    });

    assert.equal(await resolveBearer(resolveRequestAuth, wrongKidToken, secrets), undefined);
    assert.equal(requests, 3);
  } finally {
    await jwks.stop();
  }
});

test('auth adapter fails closed when jwks fetch fails', async () => {
  const { resolveRequestAuth } = await importAuthAdapter();
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks = await startJwksServer((_req, res) => {
    res.statusCode = 500;
    res.end('not available');
  });

  try {
    const token = signJwtToken(validPayload(), keyPair.privateKey, {
      alg: 'RS256',
      kid: 'unavailable-key',
    });
    const context = await resolveBearer(
      resolveRequestAuth,
      token,
      defaultSecrets({ jwtSecret: undefined, jwksUrl: jwks.url }),
    );
    assert.equal(context, undefined);
  } finally {
    await jwks.stop();
  }
});

test('auth adapter fails closed when jwks fetch times out', async () => {
  const { resolveRequestAuth } = await importAuthAdapter();
  const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.fetch = async (_url, options = {}) => {
    return await new Promise((_resolve, reject) => {
      options.signal?.addEventListener(
        'abort',
        () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        },
        { once: true },
      );
    });
  };
  globalThis.setTimeout = (callback, delay, ...args) =>
    originalSetTimeout(callback, delay === 5_000 ? 1 : delay, ...args);

  try {
    const token = signJwtToken(validPayload(), keyPair.privateKey, {
      alg: 'RS256',
      kid: 'timeout-key',
    });
    const context = await resolveBearer(
      resolveRequestAuth,
      token,
      defaultSecrets({ jwtSecret: undefined, jwksUrl: 'http://jwks.test/keys' }),
    );
    assert.equal(context, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test('auth adapter keeps service token precedence explicit and redacts diagnostics', async () => {
  const { resolveRequestAuth } = await importAuthAdapter();
  const messages = [];
  const token = signJwtToken(validPayload(), 'wrong-secret');
  const request = makeRequest({
    authorization: `Bearer ${token}`,
    'x-service-token': 'service-secret',
  });
  const logger = {
    warn(message, metadata) {
      messages.push({ message, metadata });
    },
  };

  const context = await resolveRequestAuth(
    request,
    defaultSecrets({ jwtSecret: 'jwt-secret', serviceTokens: ['service-secret'] }),
    logger,
  );

  assert.equal(context?.source, 'service-token');
  assert.equal(context?.token, 'service-secret');
  assert.deepEqual(messages, [
    {
      message: 'Bearer token validation failed',
      metadata: { reason: 'invalid_token' },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(messages), /service-secret|wrong-secret|eyJ/);
});
