import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type FlashLevel = 'info' | 'success' | 'warning' | 'error';
export type FlashPublishCondition = 'always' | 'success' | 'error';

export interface SessionCookieConfig {
  secret: string;
  cookieName: string;
  secure: boolean;
  maxAgeSeconds: number;
  path?: string;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

export interface SessionFlashMessage {
  key: string;
  level: FlashLevel;
  createdAt: string;
}

export interface RouteSessionDefinitionLike {
  mode?: 'optional' | 'required';
  write?: boolean;
}

export interface RouteFlashMessageDefinitionLike {
  key?: string;
  level?: FlashLevel;
  when?: FlashPublishCondition;
}

export interface RouteFlashDefinitionLike {
  consume?: readonly string[];
  publish?: readonly RouteFlashMessageDefinitionLike[];
}

export interface RouteFormDefinitionLike {
  session?: RouteSessionDefinitionLike;
  flash?: RouteFlashDefinitionLike;
}

export interface SessionAwareRouteDefinitionLike {
  session?: RouteSessionDefinitionLike;
  flash?: RouteFlashDefinitionLike;
  form?: RouteFormDefinitionLike;
}

export interface SessionCommitResult<TSession> {
  session: TSession | null;
  setCookie?: string;
}

export interface PreparedSessionState<TSession, TResult> {
  session: TSession | null;
  flash: SessionFlashMessage[];
  commit(options: {
    session: TSession | null;
    route?: SessionAwareRouteDefinitionLike;
    result?: TResult;
  }): SessionCommitResult<TSession>;
}

interface StoredSessionRecord {
  id: string;
  value: Record<string, unknown>;
  flash: SessionFlashMessage[];
  createdAt: string;
  expiresAt: string;
}

const SESSION_STORE_KEY = Symbol.for('webstir.webstir-backend.session-store');

export function prepareSessionState<TSession extends Record<string, unknown>, TResult extends { status?: number; errors?: unknown }>(
  options: {
    cookies?: Record<string, string> | string | string[];
    route?: SessionAwareRouteDefinitionLike;
    config: SessionCookieConfig;
    now?: () => Date;
  }
): PreparedSessionState<TSession, TResult> {
  const now = options.now ?? (() => new Date());
  const cookies = normalizeCookies(options.cookies);
  const store = getSessionStore();
  const sessionCookie = cookies[options.config.cookieName];
  const initialId = verifySignedSessionCookie(sessionCookie, options.config.secret);
  const invalidCookie = Boolean(sessionCookie) && !initialId;
  const initialRecord = initialId ? loadSessionRecord(store, initialId, now) : undefined;
  const staleCookie = Boolean(initialId) && !initialRecord;
  const delivered = resolveConsumedFlash(initialRecord?.flash ?? [], options.route);
  const initialSession = initialRecord ? (cloneValue(initialRecord.value) as TSession) : null;
  const hasPendingConsumption = delivered.flash.length > 0;

  return {
    session: initialSession,
    flash: delivered.flash,
    commit({ session, route, result }) {
      const publishFlash = resolvePublishedFlash(route ?? options.route, result, now);
      const nextSession = normalizeSessionValue<TSession>(session);

      if (initialRecord) {
        store.delete(initialRecord.id);
      }

      const shouldPersist =
        nextSession !== null ||
        publishFlash.length > 0 ||
        (initialRecord !== undefined && delivered.remaining.length > 0) ||
        hasPendingConsumption;

      if (!shouldPersist) {
        return {
          session: null,
          setCookie: initialRecord || invalidCookie || staleCookie ? serializeExpiredCookie(options.config) : undefined
        };
      }

      const record = createStoredSessionRecord({
        session: nextSession,
        fallbackId: nextSession?.id ?? (publishFlash.length > 0 ? undefined : initialRecord?.id),
        initialRecord,
        flash: [...delivered.remaining, ...publishFlash],
        config: options.config,
        now
      });

      store.set(record.id, record);

      return {
        session: cloneValue(record.value) as TSession,
        setCookie:
          initialRecord?.id === record.id && !invalidCookie && !staleCookie
            ? undefined
            : serializeSessionCookie(record.id, options.config)
      };
    }
  };
}

export function parseCookieHeader(header: string | string[] | undefined): Record<string, string> {
  return normalizeCookies(header);
}

export function resetInMemorySessionStore(): void {
  getSessionStore().clear();
}

function getSessionStore(): Map<string, StoredSessionRecord> {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[SESSION_STORE_KEY];
  if (existing instanceof Map) {
    return existing as Map<string, StoredSessionRecord>;
  }
  const store = new Map<string, StoredSessionRecord>();
  globalStore[SESSION_STORE_KEY] = store;
  return store;
}

function normalizeCookies(input: Record<string, string> | string | string[] | undefined): Record<string, string> {
  if (!input) {
    return {};
  }
  if (typeof input === 'object' && !Array.isArray(input)) {
    return { ...input };
  }
  const raw = Array.isArray(input) ? input.join('; ') : input;
  const cookies: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!name) {
      continue;
    }
    cookies[name] = decodeCookieValue(value);
  }
  return cookies;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function verifySignedSessionCookie(cookieValue: string | undefined, secret: string): string | undefined {
  if (!cookieValue) {
    return undefined;
  }
  const separatorIndex = cookieValue.indexOf('.');
  if (separatorIndex <= 0) {
    return undefined;
  }
  const sessionId = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);
  const expected = signSessionId(sessionId, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return undefined;
  }
  return timingSafeEqual(signatureBuffer, expectedBuffer) ? sessionId : undefined;
}

function signSessionId(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('base64url');
}

function loadSessionRecord(
  store: Map<string, StoredSessionRecord>,
  sessionId: string,
  now: () => Date
): StoredSessionRecord | undefined {
  const record = store.get(sessionId);
  if (!record) {
    return undefined;
  }
  const expiresAt = Date.parse(record.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt <= now().getTime()) {
    store.delete(sessionId);
    return undefined;
  }
  return record;
}

function resolveConsumedFlash(
  flash: readonly SessionFlashMessage[],
  route: SessionAwareRouteDefinitionLike | undefined
): { flash: SessionFlashMessage[]; remaining: SessionFlashMessage[] } {
  const consume = new Set<string>([
    ...(route?.flash?.consume ?? []),
    ...(route?.form?.flash?.consume ?? [])
  ]);
  if (consume.size === 0) {
    return {
      flash: [],
      remaining: flash.map((message) => ({ ...message }))
    };
  }

  const delivered: SessionFlashMessage[] = [];
  const remaining: SessionFlashMessage[] = [];
  for (const message of flash) {
    if (consume.has(message.key)) {
      delivered.push({ ...message });
      continue;
    }
    remaining.push({ ...message });
  }
  return { flash: delivered, remaining };
}

function resolvePublishedFlash<TResult extends { status?: number; errors?: unknown }>(
  route: SessionAwareRouteDefinitionLike | undefined,
  result: TResult | undefined,
  now: () => Date
): SessionFlashMessage[] {
  const definitions = [...(route?.flash?.publish ?? []), ...(route?.form?.flash?.publish ?? [])];
  if (definitions.length === 0) {
    return [];
  }

  const condition = resolveFlashCondition(result);
  return definitions
    .filter((definition) => shouldPublishFlash(definition.when, condition))
    .filter((definition): definition is RouteFlashMessageDefinitionLike & { key: string } => typeof definition.key === 'string' && definition.key.length > 0)
    .map((definition) => ({
      key: definition.key,
      level: definition.level ?? (condition === 'error' ? 'error' : 'info'),
      createdAt: now().toISOString()
    }));
}

function resolveFlashCondition(result: { status?: number; errors?: unknown } | undefined): FlashPublishCondition {
  if (result?.errors) {
    return 'error';
  }
  if ((result?.status ?? 200) >= 400) {
    return 'error';
  }
  return 'success';
}

function shouldPublishFlash(when: FlashPublishCondition | undefined, condition: FlashPublishCondition): boolean {
  if (!when || when === 'always') {
    return true;
  }
  return when === condition;
}

function normalizeSessionValue<TSession extends Record<string, unknown>>(session: TSession | null): TSession | null {
  if (session === null) {
    return null;
  }
  return cloneValue(session) as TSession;
}

function createStoredSessionRecord<TSession extends Record<string, unknown>>(options: {
  session: TSession | null;
  fallbackId?: string;
  initialRecord?: StoredSessionRecord;
  flash: SessionFlashMessage[];
  config: SessionCookieConfig;
  now: () => Date;
}): StoredSessionRecord {
  const sessionValue = (options.session ?? {}) as Record<string, unknown>;
  const sessionId = normalizeText(sessionValue.id) ?? options.fallbackId ?? randomUUID();
  const createdAt =
    normalizeDate(sessionValue.createdAt) ??
    options.initialRecord?.createdAt ??
    options.now().toISOString();
  const expiresAt =
    normalizeDate(sessionValue.expiresAt) ??
    options.initialRecord?.expiresAt ??
    new Date(options.now().getTime() + options.config.maxAgeSeconds * 1000).toISOString();

  return {
    id: sessionId,
    value: {
      ...sessionValue,
      id: sessionId,
      createdAt,
      expiresAt
    },
    flash: options.flash.map((message) => ({ ...message })),
    createdAt,
    expiresAt
  };
}

function serializeSessionCookie(sessionId: string, config: SessionCookieConfig): string {
  const value = `${encodeURIComponent(sessionId)}.${signSessionId(sessionId, config.secret)}`;
  return serializeCookie(config, value, config.maxAgeSeconds);
}

function serializeExpiredCookie(config: SessionCookieConfig): string {
  return serializeCookie(config, '', 0);
}

function serializeCookie(config: SessionCookieConfig, value: string, maxAgeSeconds: number): string {
  const parts = [`${config.cookieName}=${value}`];
  parts.push(`Path=${config.path ?? '/'}`);
  parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  parts.push(`SameSite=${config.sameSite ?? 'Lax'}`);
  parts.push('HttpOnly');
  if (config.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function normalizeText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return undefined;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
