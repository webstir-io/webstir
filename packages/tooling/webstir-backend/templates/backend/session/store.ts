import {
  createInMemorySessionStore,
  type SessionStore,
} from '@webstir-io/webstir-backend/runtime/session';
import { createSqliteSessionStore } from './sqlite.js';

const DEFAULT_SQLITE_SESSION_STORE_URL = 'file:./data/sessions.sqlite';

export function createSessionStoreFromEnv<
  TSession extends Record<string, unknown> = Record<string, unknown>,
>(env: NodeJS.ProcessEnv = process.env): SessionStore<TSession> {
  const driver = normalizeSessionStoreDriver(env);

  if (driver === 'memory') {
    return createInMemorySessionStore<TSession>();
  }

  if (driver === 'sqlite') {
    return createSqliteSessionStore<TSession>({
      url: normalizeSessionStoreUrl(env.SESSION_STORE_URL),
    });
  }

  throw new Error(
    `[session] Unsupported SESSION_STORE_DRIVER '${driver}'. Use "memory" or "sqlite".`,
  );
}

export const sessionStore = createSessionStoreFromEnv<Record<string, unknown>>();

function normalizeSessionStoreDriver(env: NodeJS.ProcessEnv): 'memory' | 'sqlite' | string {
  const normalized = env.SESSION_STORE_DRIVER?.trim().toLowerCase();
  if (!normalized) {
    if (env.SESSION_STORE_URL?.trim()) {
      return 'sqlite';
    }
    return env.NODE_ENV?.trim().toLowerCase() === 'production' ? 'sqlite' : 'memory';
  }
  return normalized;
}

function normalizeSessionStoreUrl(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_SQLITE_SESSION_STORE_URL;
}
