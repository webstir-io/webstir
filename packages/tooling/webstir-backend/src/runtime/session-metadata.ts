export interface SessionMetadata {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface SessionMetadataInput {
  id?: string;
  createdAt?: string;
  expiresAt?: string;
}

const SESSION_METADATA_KEY = Symbol.for('webstir.webstir-backend.session-metadata');
const SESSION_METADATA_FIELDS = ['id', 'createdAt', 'expiresAt'] as const;

export function attachSessionMetadata<TSession extends Record<string, unknown>>(
  session: TSession,
  metadata: SessionMetadata | undefined,
): TSession {
  const normalized = cloneSessionMetadata(metadata);
  if (!normalized) {
    return session;
  }

  Object.defineProperty(session, SESSION_METADATA_KEY, {
    configurable: true,
    enumerable: false,
    value: normalized,
    writable: true,
  });

  for (const field of SESSION_METADATA_FIELDS) {
    Object.defineProperty(session, field, {
      configurable: true,
      enumerable: false,
      value: normalized[field],
      writable: true,
    });
  }

  return session;
}

export function readSessionMetadata(
  session: Record<string, unknown> | null | undefined,
): SessionMetadataInput | undefined {
  if (!session || !isRecord(session)) {
    return undefined;
  }

  const attached = readAttachedSessionMetadata(session);
  const metadata = cloneSessionMetadataInput({
    id: normalizeText(session.id) ?? attached?.id,
    createdAt: normalizeDate(session.createdAt) ?? attached?.createdAt,
    expiresAt: normalizeDate(session.expiresAt) ?? attached?.expiresAt,
  });
  return metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function stripSessionMetadataFields(session: Record<string, unknown>): void {
  for (const field of SESSION_METADATA_FIELDS) {
    Reflect.deleteProperty(session, field);
  }
}

function readAttachedSessionMetadata(
  session: Record<string, unknown>,
): SessionMetadata | undefined {
  const attached = (session as Record<PropertyKey, unknown>)[SESSION_METADATA_KEY];
  return cloneSessionMetadata(attached);
}

function cloneSessionMetadata(value: unknown): SessionMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const metadata = cloneSessionMetadataInput(value);
  const id = metadata?.id;
  const createdAt = metadata?.createdAt;
  const expiresAt = metadata?.expiresAt;
  if (!id || !createdAt || !expiresAt) {
    return undefined;
  }

  return {
    id,
    createdAt,
    expiresAt,
  };
}

function cloneSessionMetadataInput(value: unknown): SessionMetadataInput | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const metadata: SessionMetadataInput = {};
  const id = normalizeText(value.id);
  const createdAt = normalizeDate(value.createdAt);
  const expiresAt = normalizeDate(value.expiresAt);

  if (id) {
    metadata.id = id;
  }
  if (createdAt) {
    metadata.createdAt = createdAt;
  }
  if (expiresAt) {
    metadata.expiresAt = expiresAt;
  }

  return metadata;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
