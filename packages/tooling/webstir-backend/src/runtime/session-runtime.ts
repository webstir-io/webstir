export type SessionRuntimeFormIssueCode = 'validation' | 'auth' | 'csrf';
export type SessionRuntimeFormValue = string | string[];
export type SessionRuntimeFormValues = Record<string, SessionRuntimeFormValue>;

export interface SessionRuntimeFormIssue {
  code?: SessionRuntimeFormIssueCode;
  field?: string;
  message: string;
}

export interface SessionRuntimeStoredFormState {
  values: SessionRuntimeFormValues;
  issues: SessionRuntimeFormIssue[];
  createdAt: string;
}

export interface SessionRuntimeFormState {
  csrf: Record<string, string>;
  states: Record<string, SessionRuntimeStoredFormState>;
}

export interface SessionRuntimeState {
  form?: SessionRuntimeFormState;
}

const SESSION_RUNTIME_KEY = Symbol.for('webstir.webstir-backend.session-runtime');
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

export function attachSessionRuntimeState<TSession extends Record<string, unknown>>(
  session: TSession,
  runtime: SessionRuntimeState | undefined,
): TSession {
  const normalized = cloneSessionRuntimeState(runtime);
  if (!hasSessionRuntimeState(normalized)) {
    Reflect.deleteProperty(session, SESSION_RUNTIME_KEY);
    return session;
  }

  Object.defineProperty(session, SESSION_RUNTIME_KEY, {
    configurable: true,
    enumerable: false,
    value: normalized,
    writable: true,
  });
  return session;
}

export function cloneSessionRuntimeState(
  runtime: SessionRuntimeState | undefined,
): SessionRuntimeState | undefined {
  if (!runtime || !isRecord(runtime)) {
    return undefined;
  }

  const form = cloneSessionRuntimeFormState(runtime.form);
  if (!form) {
    return undefined;
  }

  return { form };
}

export function coerceSessionRuntimeFormState(
  value: unknown,
): SessionRuntimeFormState | undefined {
  return cloneSessionRuntimeFormState(value);
}

export function getFormSessionRuntimeState(
  session: Record<string, unknown>,
): SessionRuntimeFormState {
  const existing = readAttachedSessionRuntimeState(session);
  if (existing?.form) {
    existing.form.csrf ??= {};
    existing.form.states ??= {};
    return existing.form;
  }

  const created: SessionRuntimeFormState = {
    csrf: {},
    states: {},
  };
  const runtime = {
    ...(existing ?? {}),
    form: created,
  };
  Object.defineProperty(session, SESSION_RUNTIME_KEY, {
    configurable: true,
    enumerable: false,
    value: runtime,
    writable: true,
  });
  return created;
}

export function hasSessionRuntimeState(runtime: SessionRuntimeState | undefined): boolean {
  if (!runtime?.form) {
    return false;
  }

  return (
    Object.keys(runtime.form.csrf ?? {}).length > 0 ||
    Object.keys(runtime.form.states ?? {}).length > 0
  );
}

export function mergeSessionRuntimeState(
  left: SessionRuntimeState | undefined,
  right: SessionRuntimeState | undefined,
): SessionRuntimeState | undefined {
  const leftClone = cloneSessionRuntimeState(left);
  const rightClone = cloneSessionRuntimeState(right);

  if (!leftClone) {
    return rightClone;
  }
  if (!rightClone) {
    return leftClone;
  }

  return {
    form:
      leftClone.form || rightClone.form
        ? {
            csrf: {
              ...(leftClone.form?.csrf ?? {}),
              ...(rightClone.form?.csrf ?? {}),
            },
            states: {
              ...(leftClone.form?.states ?? {}),
              ...(rightClone.form?.states ?? {}),
            },
          }
        : undefined,
  };
}

export function pruneSessionRuntimeState(session: Record<string, unknown>): void {
  const runtime = readAttachedSessionRuntimeState(session);
  if (!runtime) {
    return;
  }

  if (
    runtime.form &&
    Object.keys(runtime.form.csrf ?? {}).length === 0 &&
    Object.keys(runtime.form.states ?? {}).length === 0
  ) {
    delete runtime.form;
  }

  if (!hasSessionRuntimeState(runtime)) {
    Reflect.deleteProperty(session, SESSION_RUNTIME_KEY);
  }
}

export function readSessionRuntimeState(
  session: Record<string, unknown> | null | undefined,
): SessionRuntimeState | undefined {
  if (!session || !isRecord(session)) {
    return undefined;
  }
  return cloneSessionRuntimeState(readAttachedSessionRuntimeState(session));
}

function readAttachedSessionRuntimeState(
  session: Record<string, unknown>,
): SessionRuntimeState | undefined {
  const runtime = (session as Record<PropertyKey, unknown>)[SESSION_RUNTIME_KEY];
  return isRecord(runtime) ? (runtime as SessionRuntimeState) : undefined;
}

function cloneSessionRuntimeFormState(value: unknown): SessionRuntimeFormState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    csrf: cloneSessionRuntimeCsrfState(value.csrf),
    states: cloneSessionRuntimeStoredStateMap(value.states),
  };
}

function cloneSessionRuntimeCsrfState(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, candidate]) =>
      typeof candidate === 'string' ? [[key, candidate]] : [],
    ),
  );
}

function cloneSessionRuntimeStoredStateMap(
  value: unknown,
): Record<string, SessionRuntimeStoredFormState> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, candidate]) => {
      const state = cloneSessionRuntimeStoredFormState(candidate);
      return state ? [[key, state]] : [];
    }),
  );
}

function cloneSessionRuntimeStoredFormState(
  value: unknown,
): SessionRuntimeStoredFormState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    values: cloneSessionRuntimeFormValues(value.values),
    issues: cloneSessionRuntimeIssues(value.issues),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : EPOCH_ISO,
  };
}

function cloneSessionRuntimeFormValues(value: unknown): SessionRuntimeFormValues {
  if (!isRecord(value)) {
    return {};
  }

  const values: SessionRuntimeFormValues = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === 'string') {
      values[key] = candidate;
      continue;
    }
    if (Array.isArray(candidate) && candidate.every((item) => typeof item === 'string')) {
      values[key] = [...candidate];
    }
  }
  return values;
}

function cloneSessionRuntimeIssues(value: unknown): SessionRuntimeFormIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.message !== 'string') {
      return [];
    }

    return [
      {
        code: normalizeIssueCode(candidate.code),
        field: typeof candidate.field === 'string' ? candidate.field : undefined,
        message: candidate.message,
      },
    ];
  });
}

function normalizeIssueCode(value: unknown): SessionRuntimeFormIssueCode | undefined {
  return value === 'validation' || value === 'auth' || value === 'csrf' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string | symbol, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
