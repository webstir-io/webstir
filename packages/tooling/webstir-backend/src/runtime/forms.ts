import { randomUUID, timingSafeEqual } from 'node:crypto';

import {
  getFormSessionRuntimeState,
  pruneSessionRuntimeState,
  type SessionRuntimeFormState,
} from './session-runtime.js';

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

type FormRuntimeStore = SessionRuntimeFormState;

interface RouteHandlerResultLike {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  redirect?: {
    location: string;
  };
  errors?: { code: string; message: string; details?: unknown }[];
  rerender?: FormRerender;
}

export interface FormRerender {
  view: string;
  params?: Record<string, string>;
  form: {
    id: string;
    values: FormValues;
    issues: FormIssue[];
  };
}

export interface FormRerenderTarget {
  view: string;
  params?: Record<string, string>;
}

export interface FormState {
  submitted: boolean;
  values: FormValues;
  issues: FormIssue[];
  errors: Record<string, string>;
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
    issues: cloneIssues(stored?.issues),
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
  rerender?: string | FormRerenderTarget;
  requireAuth?:
    | boolean
    | {
        redirectTo?: string;
        message?: string;
      };
  validate?: (values: FormValues) => readonly FormIssue[] | FormIssue[] | undefined;
  now?: () => Date;
}): FormSubmissionResult<TSession, TAuth> {
  const now = options.now ?? (() => new Date());
  const session = ensureSession(options.session);
  const store = getFormRuntimeStore(session);
  const csrfFieldName = options.csrfFieldName ?? DEFAULT_CSRF_FIELD_NAME;
  const values = normalizeFormValues(options.body, csrfFieldName);
  const redirectTo = options.redirectTo;
  const rerender =
    typeof options.rerender === 'string' ? { view: options.rerender } : options.rerender;

  if (isCsrfEnabled(options)) {
    const expectedToken = ensureCsrfToken(store, options.formId);
    const providedToken = readCsrfToken(options.body, csrfFieldName);
    const matches =
      providedToken !== undefined &&
      (tokensMatch(providedToken, expectedToken) ||
        (store.token !== undefined && tokensMatch(providedToken, store.token)));
    if (!matches) {
      return failSubmission({
        session,
        store,
        formId: options.formId,
        values,
        redirectTo,
        rerender,
        now,
        issues: [
          {
            code: 'csrf',
            message: 'Form session expired. Reload the page and try again.',
          },
        ],
      });
    }
    delete store.csrf[options.formId];
  }

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
              : 'Sign-in required to submit this form.',
        },
      ],
    });
  }

  const validationResult = options.validate?.(values);
  const validationIssues = cloneIssues(
    Array.isArray(validationResult) ? validationResult : undefined,
  );
  if (validationIssues.length > 0) {
    return failSubmission({
      session,
      store,
      formId: options.formId,
      values,
      redirectTo,
      rerender,
      now,
      issues: validationIssues.map((issue) => ({
        ...issue,
        code: issue.code ?? 'validation',
      })),
    });
  }

  delete store.states[options.formId];
  cleanupFormRuntimeStore(session);
  return {
    ok: true,
    session,
    values,
    auth: options.auth,
  };
}

export function readFormState(session: Record<string, unknown> | null, formId: string): FormState {
  if (!session) {
    return createFormState(undefined, undefined);
  }
  const store = getFormRuntimeStore(session);
  const stored = store.states[formId];
  if (stored) {
    delete store.states[formId];
  }
  cleanupFormRuntimeStore(session);
  return createFormState(stored?.values, stored?.issues);
}

export function createFormState(
  values: FormValues | undefined,
  issues: readonly FormIssue[] | undefined,
): FormState {
  const clonedIssues = cloneIssues(issues);
  return {
    submitted: values !== undefined || clonedIssues.length > 0,
    values: cloneFormValues(values),
    issues: clonedIssues,
    errors: formErrors(clonedIssues),
  };
}

export function formErrors(issues: readonly FormIssue[] | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues ?? []) {
    if (!issue?.message) {
      continue;
    }
    const key = issue.field ?? 'form';
    errors[key] ??= issue.message;
  }
  return errors;
}

export function ensureSessionCsrfToken<TSession extends Record<string, unknown>>(
  session: TSession | null,
): { session: TSession; token: string } {
  const ensured = ensureSession(session);
  const store = getFormRuntimeStore(ensured);
  store.token ??= randomUUID();
  return { session: ensured, token: store.token };
}

export function groupFormIssuesByField(issues: readonly FormIssue[] | undefined): {
  form: string[];
  fields: Record<string, string[]>;
} {
  const grouped = {
    form: [] as string[],
    fields: {} as Record<string, string[]>,
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
  rerender?: FormRerenderTarget;
  issues: FormIssue[];
  now: () => Date;
}): FormSubmissionResult<TSession, never> {
  if (options.rerender) {
    // The failure renders in this response, so nothing waits in the session for a later page.
    delete options.store.states[options.formId];
    cleanupFormRuntimeStore(options.session);
    return {
      ok: false,
      session: options.session,
      values: options.values,
      issues: options.issues,
      result: {
        status: options.issues.some((issue) => issue.code === 'csrf') ? 403 : 422,
        rerender: {
          view: options.rerender.view,
          ...(options.rerender.params ? { params: { ...options.rerender.params } } : {}),
          form: {
            id: options.formId,
            values: cloneFormValues(options.values),
            issues: cloneIssues(options.issues),
          },
        },
      },
    };
  }

  options.store.states[options.formId] = {
    values: cloneFormValues(options.values),
    issues: cloneIssues(options.issues),
    createdAt: options.now().toISOString(),
  };
  cleanupFormRuntimeStore(options.session);

  const errors = options.issues.map((issue) => ({
    code: issue.code === 'auth' ? 'auth' : 'validation',
    message: issue.message,
    details: issue.field
      ? { field: issue.field, reason: issue.code ?? 'validation' }
      : { reason: issue.code ?? 'validation' },
  }));

  if (options.redirectTo) {
    // The redirect keeps the HTML-first flow, and `errors` marks the outcome as a failure so
    // route-level flash publishing (`when: 'success'`) does not treat the 303 as success.
    return {
      ok: false,
      session: options.session,
      values: options.values,
      issues: options.issues,
      result: {
        status: 303,
        redirect: {
          location: options.redirectTo,
        },
        errors,
      },
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
      errors,
    },
  };
}

function ensureSession<TSession extends Record<string, unknown>>(
  session: TSession | null,
): TSession {
  if (session && typeof session === 'object' && !Array.isArray(session)) {
    return session;
  }
  return {} as TSession;
}

function getFormRuntimeStore(session: Record<string, unknown>): FormRuntimeStore {
  return getFormSessionRuntimeState(session);
}

function cleanupFormRuntimeStore(session: Record<string, unknown>): void {
  pruneSessionRuntimeState(session);
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
    Object.entries(values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
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

function requiresAuth(
  option: { redirectTo?: string; message?: string } | boolean | undefined,
): boolean {
  return option === true || typeof option === 'object';
}

function resolveAuthRedirect(
  option: { redirectTo?: string; message?: string } | boolean | undefined,
  fallback: string | undefined,
): string | undefined {
  if (typeof option === 'object' && option.redirectTo) {
    return option.redirectTo;
  }
  return fallback;
}
