import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { backendProvider } from '../dist/index.js';

async function createTempWorkspace(prefix = 'webstir-backend-env-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
}

async function copyFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function seedBackendWorkspace(workspace, name) {
  const assets = await backendProvider.getScaffoldAssets();
  for (const asset of assets) {
    await copyFile(asset.sourcePath, path.join(workspace, asset.targetPath));
  }

  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '0.0.0',
        type: 'module',
      },
      null,
      2,
    ),
    'utf8',
  );
}

function getLocalBinPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  return path.join(pkgRoot, 'node_modules', '.bin');
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test('env loader reads .env files and surfaces typed config', async () => {
  const workspace = await createTempWorkspace();
  await seedBackendWorkspace(workspace, '@demo/env-loader');

  const envContents = `NODE_ENV=development\nPORT=5055\nAPI_BASE_URL=https://api.example.com\n`;
  await fs.writeFile(path.join(workspace, '.env'), envContents, 'utf8');

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    NODE_OPTIONS: '--experimental-transform-types',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const builtEnvModule = path.join(workspace, 'build', 'backend', 'env.js');
  const previousEnv = snapshotEnv(['NODE_ENV', 'PORT', 'API_BASE_URL']);

  try {
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    delete process.env.API_BASE_URL;

    const mod = await import(pathToFileURL(builtEnvModule).href);
    const loaded = mod.loadEnv();

    assert.equal(loaded.PORT, 5055);
    assert.equal(loaded.API_BASE_URL, 'https://api.example.com');
  } finally {
    restoreEnv(previousEnv);
  }
});

test('env loader generates a non-literal session secret fallback when unset', async () => {
  const workspace = await createTempWorkspace('webstir-backend-env-session-');
  await seedBackendWorkspace(workspace, '@demo/env-loader-session');

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    NODE_OPTIONS: '--experimental-transform-types',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousJwtSecret = process.env.AUTH_JWT_SECRET;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPort = process.env.PORT;
  const previousApiBaseUrl = process.env.API_BASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.AUTH_JWT_SECRET;

  try {
    await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

    const builtEnvModule = path.join(workspace, 'build', 'backend', 'env.js');
    const mod = await import(pathToFileURL(builtEnvModule).href);
    const first = mod.loadEnv();
    const second = mod.loadEnv();

    assert.notEqual(first.sessions.secret, 'webstir-dev-session-secret');
    assert.equal(first.sessions.secret, second.sessions.secret);
    assert.ok(first.sessions.secret.length >= 32);
  } finally {
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }
    if (previousJwtSecret === undefined) {
      delete process.env.AUTH_JWT_SECRET;
    } else {
      process.env.AUTH_JWT_SECRET = previousJwtSecret;
    }
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previousPort;
    }
    if (previousApiBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = previousApiBaseUrl;
    }
  }
});

test('env loader requires SESSION_SECRET in production', async () => {
  const workspace = await createTempWorkspace('webstir-backend-env-session-prod-');
  await seedBackendWorkspace(workspace, '@demo/env-loader-session-prod');

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    NODE_OPTIONS: '--experimental-transform-types',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const previousEnv = snapshotEnv(['NODE_ENV', 'SESSION_SECRET', 'AUTH_JWT_SECRET']);

  try {
    await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

    const builtEnvModule = path.join(workspace, 'build', 'backend', 'env.js');
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_SECRET;
    delete process.env.AUTH_JWT_SECRET;

    const mod = await import(pathToFileURL(builtEnvModule).href);
    assert.throws(() => mod.loadEnv(), /SESSION_SECRET is required when NODE_ENV=production/);
  } finally {
    restoreEnv(previousEnv);
  }
});

test('env loader falls back from blank WORKSPACE_ROOT to WEBSTIR_WORKSPACE_ROOT outside the workspace cwd', async () => {
  const workspace = await createTempWorkspace('webstir-backend-env-root-');
  const alternateCwd = await createTempWorkspace('webstir-backend-env-root-cwd-');
  await seedBackendWorkspace(workspace, '@demo/env-loader-root');
  await fs.writeFile(
    path.join(workspace, '.env'),
    'PORT=6060\nAPI_BASE_URL=https://root.example.com\n',
    'utf8',
  );

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    NODE_OPTIONS: '--experimental-transform-types',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const builtEnvModule = path.join(workspace, 'build', 'backend', 'env.js');
  const previousEnv = snapshotEnv([
    'WORKSPACE_ROOT',
    'WEBSTIR_WORKSPACE_ROOT',
    'PORT',
    'API_BASE_URL',
  ]);
  const previousCwd = process.cwd();

  try {
    process.env.WORKSPACE_ROOT = '   ';
    process.env.WEBSTIR_WORKSPACE_ROOT = workspace;
    delete process.env.PORT;
    delete process.env.API_BASE_URL;
    process.chdir(alternateCwd);

    const mod = await import(pathToFileURL(builtEnvModule).href);
    const loaded = mod.loadEnv();

    assert.equal(loaded.PORT, 6060);
    assert.equal(loaded.API_BASE_URL, 'https://root.example.com');
  } finally {
    process.chdir(previousCwd);
    restoreEnv(previousEnv);
  }
});

test('env loader infers workspace root from the built module path outside the workspace cwd', async () => {
  const workspace = await createTempWorkspace('webstir-backend-env-infer-');
  const alternateCwd = await createTempWorkspace('webstir-backend-env-infer-cwd-');
  await seedBackendWorkspace(workspace, '@demo/env-loader-infer');
  await fs.writeFile(
    path.join(workspace, '.env'),
    'PORT=7070\nAPI_BASE_URL=https://infer.example.com\n',
    'utf8',
  );

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    NODE_OPTIONS: '--experimental-transform-types',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const builtEnvModule = path.join(workspace, 'build', 'backend', 'env.js');
  const previousEnv = snapshotEnv([
    'WORKSPACE_ROOT',
    'WEBSTIR_WORKSPACE_ROOT',
    'PORT',
    'API_BASE_URL',
  ]);
  const previousCwd = process.cwd();

  try {
    delete process.env.WORKSPACE_ROOT;
    delete process.env.WEBSTIR_WORKSPACE_ROOT;
    delete process.env.PORT;
    delete process.env.API_BASE_URL;
    process.chdir(alternateCwd);

    const mod = await import(pathToFileURL(builtEnvModule).href);
    const loaded = mod.loadEnv();

    assert.equal(loaded.PORT, 7070);
    assert.equal(loaded.API_BASE_URL, 'https://infer.example.com');
  } finally {
    process.chdir(previousCwd);
    restoreEnv(previousEnv);
  }
});

test('env loader resolves AUTH_JWT_PUBLIC_KEY_FILE from the workspace root', async () => {
  const workspace = await createTempWorkspace('webstir-backend-env-auth-key-');
  const alternateCwd = await createTempWorkspace('webstir-backend-env-auth-key-cwd-');
  await seedBackendWorkspace(workspace, '@demo/env-loader-auth-key');

  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  await fs.mkdir(path.join(workspace, 'config'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'config', 'jwt-public.pem'), publicKeyPem, 'utf8');

  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    NODE_OPTIONS: '--experimental-transform-types',
    PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const builtEnvModule = path.join(workspace, 'build', 'backend', 'env.js');
  const previousEnv = snapshotEnv([
    'WORKSPACE_ROOT',
    'WEBSTIR_WORKSPACE_ROOT',
    'AUTH_JWT_PUBLIC_KEY',
    'AUTH_JWT_PUBLIC_KEY_FILE',
  ]);
  const previousCwd = process.cwd();

  try {
    process.env.WORKSPACE_ROOT = '   ';
    process.env.WEBSTIR_WORKSPACE_ROOT = workspace;
    delete process.env.AUTH_JWT_PUBLIC_KEY;
    process.env.AUTH_JWT_PUBLIC_KEY_FILE = 'config/jwt-public.pem';
    process.chdir(alternateCwd);

    const mod = await import(pathToFileURL(builtEnvModule).href);
    const loaded = mod.loadEnv();

    assert.match(loaded.auth.jwtPublicKey ?? '', /BEGIN PUBLIC KEY/);
  } finally {
    process.chdir(previousCwd);
    restoreEnv(previousEnv);
  }
});
