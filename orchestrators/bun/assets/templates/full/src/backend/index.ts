import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  startBunBackend,
  type BunRuntimeEnvLike,
  type MetricsTracker,
  type RuntimeLogger,
} from '@webstir-io/webstir-backend/runtime/bun';
import { createInMemorySessionStore } from '@webstir-io/webstir-backend/runtime/session';

type BackendEnv = BunRuntimeEnvLike<Record<string, never>, Record<string, never>>;

const GENERATED_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const sessionStore = createInMemorySessionStore<Record<string, unknown>>();

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

function resolveWorkspaceRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function createBaseLogger(): RuntimeLogger {
  return {
    child() {
      return this;
    },
    info(value: unknown, message?: string) {
      writeLog('info', value, message);
    },
    warn(value: unknown, message?: string) {
      writeLog('warn', value, message);
    },
    error(value: unknown, message?: string) {
      writeLog('error', value, message);
    },
  };
}

function createMetricsTracker(): MetricsTracker {
  return {
    record() {},
    snapshot() {
      return { enabled: false };
    },
  };
}

function writeLog(level: 'info' | 'warn' | 'error', value: unknown, message?: string): void {
  const line = typeof value === 'string' && !message ? value : message;
  const detail = typeof value === 'string' && !message ? undefined : value;
  const output = [line, detail ? JSON.stringify(detail) : undefined].filter(Boolean).join(' ');

  if (level === 'error') {
    console.error(output);
    return;
  }

  if (level === 'warn') {
    console.warn(output);
    return;
  }

  console.log(output);
}

export async function start(): Promise<void> {
  await startBunBackend({
    importMetaUrl: import.meta.url,
    loadEnv,
    resolveWorkspaceRoot,
    resolveRequestAuth: async () => undefined,
    createBaseLogger,
    createMetricsTracker,
    sessionStore,
  });
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
