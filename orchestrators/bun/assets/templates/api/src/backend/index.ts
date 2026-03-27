import crypto from 'node:crypto';

import {
  createDefaultBunBackendBootstrap,
  startBunBackend,
  type BunRuntimeEnvLike,
} from '@webstir-io/webstir-backend';

type BackendEnv = BunRuntimeEnvLike<Record<string, never>, Record<string, never>>;

const GENERATED_SESSION_SECRET = crypto.randomBytes(32).toString('hex');

function loadEnv(): BackendEnv {
  const port = Number(process.env.PORT ?? '4321');

  return {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: Number.isFinite(port) ? port : 4321,
    auth: {},
    metrics: {},
    http: {
      bodyLimitBytes: 1_048_576,
    },
    sessions: {
      secret: resolveSessionSecret(),
      cookieName: 'webstir_session',
      secure: false,
      maxAgeSeconds: 60 * 60 * 24 * 7,
      path: '/',
      sameSite: 'Lax',
    },
  };
}

function resolveSessionSecret(): string {
  const explicitSecret = process.env.SESSION_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  if ((process.env.NODE_ENV ?? 'development').trim().toLowerCase() === 'production') {
    throw new Error('SESSION_SECRET is required when NODE_ENV=production.');
  }

  return process.env.AUTH_JWT_SECRET ?? GENERATED_SESSION_SECRET;
}

export async function start(): Promise<void> {
  await startBunBackend(
    createDefaultBunBackendBootstrap({
      importMetaUrl: import.meta.url,
      loadEnv,
    }),
  );
}

const isMain = (() => {
  try {
    const argv1 = process.argv?.[1];
    if (!argv1) return false;
    const here = new URL(import.meta.url);
    const run = new URL(`file://${argv1}`);
    return here.pathname === run.pathname;
  } catch {
    return false;
  }
})();

if (isMain) {
  start().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
