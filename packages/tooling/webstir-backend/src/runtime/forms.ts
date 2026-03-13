import { randomUUID, timingSafeEqual } from 'node:crypto';

export type FormIssueCode = 'validation' | 'auth' | 'csrf';
export type FormValue = string | string[];
export type FormValues = Record<string, FormValue>;

export interface FormIssue {
  code?: FormIssueCode;
  field?: string;
  message: string;
}

export interface FormRouteDefinitionLike {
  path?: string;
  form?: {
    csrf?: boolean;
  };
}

export interface PreparedFormState<TSession extends Record<string, unknown>> {
  session: TSession;
  csrfToken?: string;
  values: FormValues;
  issues: FormIssue[];
}

interface StoredFormState {
  values: FormValues;
  issues: FormIssue[];
  createdAt: string;
}

interface FormRuntimeStore {
  csrf: Record<string, string>;
  states: Record<string, StoredFormState>;
}

interface RouteHandlerResultLike {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  redirect?: {
    location: string;
  };
  errors?: { code: string; message: string; details?: unknown }[];
}

export type FormSubmissionResult<TSession extends Record<string, unknown>, TAuth> =
  | {
      ok: true;
      session: TSession;
      values: FormValues;
      auth: TAuth | undefined;
    }
  | {
      ok: false;
      session: TSession;
      values: FormValues;
      issues: FormIssue[];
      result: RouteHandlerResultLike;
    };

const FORM_RUNTIME_KEY = '__webstir_form_runtime';
const DEFAULT_CSRF_FIELD_NAME = '_csrf';

export function prepareFormState<TSession extends Record<string, unknown>>(options: {
  session: TSession | null;
  formId: string;
  route?: FormRouteDefinitionLike;
  csrf?: boolean;
  now?: () => Date;
}): PreparedFormState<TSession> {
  const session = ensureSession(options.session);
  const store = getFormRuntimeStore(session);
  const stored = store.states[options.formId];
  if (stored) {
    delete store.states[options.formId];
  }

  let csrfToken: string | undefined;
  if (isCsrfEnabled(options)) {
    csrfToken = ensureCsrfToken(store, options.formId);
  }

  cleanupFormRuntimeStore(session);
  return {
    session,
    csrfToken,
    values: cloneFormValues(stored?.values),
    issues: cloneIssues(stored?.issues)
  };
}

export function processFormSubmission<TSession extends Record<string, unknown>, TAuth>(options: {
  session: TSession | null;
  body: unknown;
  auth?: TAuth;
  formId: string;
  route?: FormRouteDefinitionLike;
  csrf?: boolean;
  csrfFieldName?: string;
  redirectTo?: string;
  requireAuth?:
    | boolean
    | {
        redirectTo?: string;
        message?: string;
      };
  validate?: (values: FormValues) => readonly FormIssue[] | FormIssue[] | void;
  now?: () => Date;
}): FormSubmissionResult<TSession, TAuth> {
  const now = options.now ?? (() => new Date());
  const session = ensureSession(options.session);
  const store = getFormRuntimeStore(session);
  const csrfFieldName = options.csrfFieldName ?? DEFAULT_CSRF_FIELD_NAME;
  const values = normalizeFormValues(options.body, csrfFieldName);
  const redirectTo = options.redirectTo;

  if (requiresAuth(options.requireAuth) && options.auth === undefined) {
    return failSubmission({
      session,
      store,
      formId: options.formId,
      values,
      redirectTo: resolveAuthRedirect(options.requireAuth, redirectTo),
      now,
      issues: [
        {
          code: 'auth',
          message:
            typeof options.requireAuth === 'object' && options.requireAuth.message
              ? options.requireAuth.message
              : 'Sign-in required to submit this form.'
        }
      ]
    });
  }

  if (isCsrfEnabled(options)) {
    const expectedToken = ensureCsrfToken(store, options.formId);
    const providedToken = readCsrfToken(options.body, csrfFieldName);
    if (!providedToken || !tokensMatch(providedToken, expectedToken)) {
      return failSubmission({
        session,
        store,
        formId: options.formId,
        values,
        redirectTo,
        now,
        issues: [
          {
            code: 'csrf',
            message: 'Form session expired. Reload the page and try again.'
          }
        ]
      });
    }
  }

  const validationResult = options.validate?.(values);
  const validationIssues = cloneIssues(Array.isArray(validationResult) ? validationResult : undefined);
  if (validationIssues.length > 0) {
    return failSubmission({
      session,
      store,
      formId: options.formId,
      values,
      redirectTo,
      now,
      issues: validationIssues.map((issue) => ({
        ...issue,
        code: issue.code ?? 'validation'
      }))
    });
  }

  delete store.states[options.formId];
  cleanupFormRuntimeStore(session);
  return {
    ok: true,
    session,
    values,
    auth: options.auth
  };
}

export function groupFormIssuesByField(issues: readonly FormIssue[] | undefined): {
  form: string[];
  fields: Record<string, string[]>;
} {
  const grouped = {
    form: [] as string[],
    fields: {} as Record<string, string[]>
  };
  for (const issue of issues ?? []) {
    if (!issue?.message) {
      continue;
    }
    if (!issue.field) {
      grouped.form.push(issue.message);
      continue;
    }
    grouped.fields[issue.field] ??= [];
    grouped.fields[issue.field].push(issue.message);
  }
  return grouped;
}

function failSubmission<TSession extends Record<string, unknown>>(options: {
  session: TSession;
  store: FormRuntimeStore;
  formId: string;
  values: FormValues;
  redirectTo?: string;
  issues: FormIssue[];
  now: () => Date;
}): FormSubmissionResult<TSession, never> {
  options.store.states[options.formId] = {
    values: cloneFormValues(options.values),
    issues: cloneIssues(options.issues),
    createdAt: options.now().toISOString()
  };
  cleanupFormRuntimeStore(options.session);

  if (options.redirectTo) {
    return {
      ok: false,
      session: options.session,
      values: options.values,
      issues: options.issues,
      result: {
        status: 303,
        redirect: {
          location: options.redirectTo
        }
      }
    };
  }

  const status = options.issues.some((issue) => issue.code === 'auth')
    ? 401
    : options.issues.some((issue) => issue.code === 'csrf')
      ? 403
      : 422;

  return {
    ok: false,
    session: options.session,
    values: options.values,
    issues: options.issues,
    result: {
      status,
      errors: options.issues.map((issue) => ({
        code: issue.code === 'auth' ? 'auth' : 'validation',
        message: issue.message,
        details: issue.field ? { field: issue.field, reason: issue.code ?? 'validation' } : { reason: issue.code ?? 'validation' }
      }))
    }
  };
}

function ensureSession<TSession extends Record<string, unknown>>(session: TSession | null): TSession {
  if (session && typeof session === 'object' && !Array.isArray(session)) {
    return session;
  }
  return {} as TSession;
}

function getFormRuntimeStore(session: Record<string, unknown>): FormRuntimeStore {
  const existing = session[FORM_RUNTIME_KEY];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const typed = existing as Partial<FormRuntimeStore>;
    typed.csrf ??= {};
    typed.states ??= {};
    session[FORM_RUNTIME_KEY] = typed;
    return typed as FormRuntimeStore;
  }

  const created: FormRuntimeStore = {
    csrf: {},
    states: {}
  };
  session[FORM_RUNTIME_KEY] = created;
  return created;
}

function cleanupFormRuntimeStore(session: Record<string, unknown>): void {
  const existing = session[FORM_RUNTIME_KEY];
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return;
  }
  const typed = existing as FormRuntimeStore;
  const hasCsrf = Object.keys(typed.csrf ?? {}).length > 0;
  const hasStates = Object.keys(typed.states ?? {}).length > 0;
  if (!hasCsrf && !hasStates) {
    delete session[FORM_RUNTIME_KEY];
  }
}

function ensureCsrfToken(store: FormRuntimeStore, formId: string): string {
  const existing = store.csrf[formId];
  if (existing) {
    return existing;
  }
  const generated = randomUUID();
  store.csrf[formId] = generated;
  return generated;
}

function readCsrfToken(body: unknown, fieldName: string): string | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[fieldName];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].length > 0) {
    return value[0];
  }
  return undefined;
}

function normalizeFormValues(body: unknown, csrfFieldName: string): FormValues {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  const values: FormValues = {};
  for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
    if (key === csrfFieldName) {
      continue;
    }
    if (typeof raw === 'string') {
      values[key] = raw;
      continue;
    }
    if (Array.isArray(raw) && raw.every((value) => typeof value === 'string')) {
      values[key] = [...raw];
    }
  }
  return values;
}

function cloneFormValues(values: FormValues | undefined): FormValues {
  if (!values) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])
  );
}

function cloneIssues(issues: readonly FormIssue[] | undefined): FormIssue[] {
  return (issues ?? []).map((issue) => ({ ...issue }));
}

function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isCsrfEnabled(options: { route?: FormRouteDefinitionLike; csrf?: boolean }): boolean {
  return options.csrf ?? options.route?.form?.csrf ?? false;
}

function requiresAuth(option: { redirectTo?: string; message?: string } | boolean | undefined): boolean {
  return option === true || typeof option === 'object';
}

function resolveAuthRedirect(
  option: { redirectTo?: string; message?: string } | boolean | undefined,
  fallback: string | undefined
): string | undefined {
  if (typeof option === 'object' && option.redirectTo) {
    return option.redirectTo;
  }
  return fallback;
}
