import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import {
  attachSessionRuntimeState,
  cloneSessionRuntimeState,
  coerceSessionRuntimeFormState,
  hasSessionRuntimeState,
  mergeSessionRuntimeState,
  readSessionRuntimeState,
  type SessionRuntimeState,
} from './session-runtime.js';

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

export interface SessionStoreRecord<
  TSession extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  value: TSession;
  flash: SessionFlashMessage[];
  runtime?: SessionRuntimeState;
  createdAt: string;
  expiresAt: string;
}

export interface SessionStore<TSession extends Record<string, unknown> = Record<string, unknown>> {
  get(sessionId: string): SessionStoreRecord<TSession> | undefined;
  set(record: SessionStoreRecord<TSession>): void;
  delete(sessionId: string): void;
}

export interface InMemorySessionStore<
  TSession extends Record<string, unknown> = Record<string, unknown>,
> extends SessionStore<TSession> {
  clear(): void;
}

const SESSION_STORE_KEY = Symbol.for('webstir.webstir-backend.session-store');
const LEGACY_FORM_RUNTIME_KEY = '__webstir_form_runtime';

export function prepareSessionState<
  TSession extends Record<string, unknown>,
  TResult extends { status?: number; errors?: unknown },
>(options: {
  cookies?: Record<string, string> | string | string[];
  route?: SessionAwareRouteDefinitionLike;
  config: SessionCookieConfig;
  store?: SessionStore<TSession>;
  now?: () => Date;
}): PreparedSessionState<TSession, TResult> {
  const now = options.now ?? (() => new Date());
  const cookies = normalizeCookies(options.cookies);
  const store = options.store ?? getDefaultSessionStore<TSession>();
  const sessionCookie = cookies[options.config.cookieName];
  const initialId = verifySignedSessionCookie(sessionCookie, options.config.secret);
  const invalidCookie = Boolean(sessionCookie) && !initialId;
  const initialRecord = initialId ? loadSessionRecord(store, initialId, now) : undefined;
  const staleCookie = Boolean(initialId) && !initialRecord;
  const delivered = resolveConsumedFlash(initialRecord?.flash ?? [], options.route);
  const initialState = initialRecord ? restoreStoredSessionState(initialRecord) : undefined;
  const initialSession =
    initialState?.session
      ? attachSessionRuntimeState(initialState.session, initialState.runtime)
      : null;
  const hasPendingConsumption = delivered.flash.length > 0;

  return {
    session: initialSession,
    flash: delivered.flash,
    commit({ session, route, result }) {
      const publishFlash = resolvePublishedFlash(route ?? options.route, result, now);
      const normalized = normalizeSessionValue<TSession>(session);

      if (initialRecord) {
        store.delete(initialRecord.id);
      }

      const shouldPersist =
        normalized.session !== null ||
        publishFlash.length > 0 ||
        (initialRecord !== undefined && delivered.remaining.length > 0) ||
        hasPendingConsumption ||
        hasSessionRuntimeState(normalized.runtime);

      if (!shouldPersist) {
        return {
          session: null,
          setCookie:
            initialRecord || invalidCookie || staleCookie
              ? serializeExpiredCookie(options.config)
              : undefined,
        };
      }

      const record = createStoredSessionRecord({
        session: normalized.session,
        runtime: normalized.runtime,
        fallbackId:
          normalizeText(normalized.session?.id) ??
          (publishFlash.length > 0 ? undefined : initialRecord?.id),
        initialRecord,
        flash: [...delivered.remaining, ...publishFlash],
        config: options.config,
        now,
      });

      store.set(record);

      return {
        session: attachSessionRuntimeState(cloneValue(record.value) as TSession, record.runtime),
        setCookie:
          initialRecord?.id === record.id && !invalidCookie && !staleCookie
            ? undefined
            : serializeSessionCookie(record.id, options.config),
      };
    },
  };
}

export function parseCookieHeader(header: string | string[] | undefined): Record<string, string> {
  return normalizeCookies(header);
}

export function createInMemorySessionStore<
  TSession extends Record<string, unknown> = Record<string, unknown>,
>(): InMemorySessionStore<TSession> {
  const records = new Map<string, SessionStoreRecord<TSession>>();
  return {
    get(sessionId) {
      const record = records.get(sessionId);
      return record ? cloneStoredSessionRecord(record) : undefined;
    },
    set(record) {
      records.set(record.id, cloneStoredSessionRecord(record));
    },
    delete(sessionId) {
      records.delete(sessionId);
    },
    clear() {
      records.clear();
    },
  };
}

export function resetInMemorySessionStore(
  store: InMemorySessionStore<Record<string, unknown>> = getDefaultInMemorySessionStore(),
): void {
  store.clear();
}

function getDefaultSessionStore<
  TSession extends Record<string, unknown>,
>(): SessionStore<TSession> {
  return getDefaultInMemorySessionStore() as SessionStore<TSession>;
}

function getDefaultInMemorySessionStore(): InMemorySessionStore<Record<string, unknown>> {
  const globalStore = globalThis as Record<PropertyKey, unknown>;
  const existing = globalStore[SESSION_STORE_KEY];
  if (isInMemorySessionStore(existing)) {
    return existing;
  }
  const store = createInMemorySessionStore<Record<string, unknown>>();
  globalStore[SESSION_STORE_KEY] = store;
  return store;
}

function normalizeCookies(
  input: Record<string, string> | string | string[] | undefined,
): Record<string, string> {
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

function verifySignedSessionCookie(
  cookieValue: string | undefined,
  secret: string,
): string | undefined {
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

function loadSessionRecord<TSession extends Record<string, unknown>>(
  store: SessionStore<TSession>,
  sessionId: string,
  now: () => Date,
): SessionStoreRecord<TSession> | undefined {
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
  route: SessionAwareRouteDefinitionLike | undefined,
): { flash: SessionFlashMessage[]; remaining: SessionFlashMessage[] } {
  const consume = new Set<string>([
    ...(route?.flash?.consume ?? []),
    ...(route?.form?.flash?.consume ?? []),
  ]);
  if (consume.size === 0) {
    return {
      flash: [],
      remaining: flash.map((message) => ({ ...message })),
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
  now: () => Date,
): SessionFlashMessage[] {
  const definitions = [...(route?.flash?.publish ?? []), ...(route?.form?.flash?.publish ?? [])];
  if (definitions.length === 0) {
    return [];
  }

  const condition = resolveFlashCondition(result);
  return definitions
    .filter((definition) => shouldPublishFlash(definition.when, condition))
    .filter(
      (definition): definition is RouteFlashMessageDefinitionLike & { key: string } =>
        typeof definition.key === 'string' && definition.key.length > 0,
    )
    .map((definition) => ({
      key: definition.key,
      level: definition.level ?? (condition === 'error' ? 'error' : 'info'),
      createdAt: now().toISOString(),
    }));
}

function resolveFlashCondition(
  result: { status?: number; errors?: unknown } | undefined,
): FlashPublishCondition {
  if (result?.errors) {
    return 'error';
  }
  if ((result?.status ?? 200) >= 400) {
    return 'error';
  }
  return 'success';
}

function shouldPublishFlash(
  when: FlashPublishCondition | undefined,
  condition: FlashPublishCondition,
): boolean {
  if (!when || when === 'always') {
    return true;
  }
  return when === condition;
}

function normalizeSessionValue<TSession extends Record<string, unknown>>(
  session: TSession | null,
): { session: TSession | null; runtime?: SessionRuntimeState } {
  if (session === null) {
    return { session: null };
  }

  const cloned = cloneValue(session) as Record<string, unknown>;
  delete cloned[LEGACY_FORM_RUNTIME_KEY];

  return {
    session: cloned as TSession,
    runtime: readSessionRuntimeState(session),
  };
}

function createStoredSessionRecord<TSession extends Record<string, unknown>>(options: {
  session: TSession | null;
  runtime?: SessionRuntimeState;
  fallbackId?: string;
  initialRecord?: SessionStoreRecord<TSession>;
  flash: SessionFlashMessage[];
  config: SessionCookieConfig;
  now: () => Date;
}): SessionStoreRecord<TSession> {
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
      expiresAt,
    } as unknown as TSession,
    flash: options.flash.map((message) => ({ ...message })),
    runtime: cloneSessionRuntimeState(options.runtime),
    createdAt,
    expiresAt,
  };
}

function serializeSessionCookie(sessionId: string, config: SessionCookieConfig): string {
  const value = `${encodeURIComponent(sessionId)}.${signSessionId(sessionId, config.secret)}`;
  return serializeCookie(config, value, config.maxAgeSeconds);
}

function serializeExpiredCookie(config: SessionCookieConfig): string {
  return serializeCookie(config, '', 0);
}

function serializeCookie(
  config: SessionCookieConfig,
  value: string,
  maxAgeSeconds: number,
): string {
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

function cloneStoredSessionRecord<TSession extends Record<string, unknown>>(
  record: SessionStoreRecord<TSession>,
): SessionStoreRecord<TSession> {
  return {
    id: record.id,
    value: cloneValue(record.value),
    flash: record.flash.map((message) => ({ ...message })),
    runtime: cloneSessionRuntimeState(record.runtime),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function restoreStoredSessionState<TSession extends Record<string, unknown>>(
  record: SessionStoreRecord<TSession>,
): { session: TSession; runtime?: SessionRuntimeState } {
  const session = cloneValue(record.value) as Record<string, unknown>;
  const legacyRuntime = restoreLegacyFormRuntime(session);

  return {
    session: session as TSession,
    runtime: mergeSessionRuntimeState(record.runtime, legacyRuntime),
  };
}

function restoreLegacyFormRuntime(
  session: Record<string, unknown>,
): SessionRuntimeState | undefined {
  const legacy = coerceSessionRuntimeFormState(session[LEGACY_FORM_RUNTIME_KEY]);
  delete session[LEGACY_FORM_RUNTIME_KEY];
  return legacy ? { form: legacy } : undefined;
}

function isInMemorySessionStore(
  value: unknown,
): value is InMemorySessionStore<Record<string, unknown>> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as InMemorySessionStore<Record<string, unknown>>).get === 'function' &&
      typeof (value as InMemorySessionStore<Record<string, unknown>>).set === 'function' &&
      typeof (value as InMemorySessionStore<Record<string, unknown>>).delete === 'function' &&
      typeof (value as InMemorySessionStore<Record<string, unknown>>).clear === 'function',
  );
}
