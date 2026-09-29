const VIEW_CONTROL = Symbol.for('webstir.webstir-backend.view-control');

export type ViewRedirectStatus = 301 | 302 | 303 | 307 | 308;

export interface ViewRedirect {
  readonly [VIEW_CONTROL]: 'redirect';
  readonly location: string;
  readonly status: ViewRedirectStatus;
}

export interface ViewNotFound {
  readonly [VIEW_CONTROL]: 'not-found';
}

/** Ends a view's loader with a redirect instead of a rendered page. */
export function redirect(location: string, status: ViewRedirectStatus = 303): never {
  throw Object.assign(new Error(`Redirect to ${location}`), {
    [VIEW_CONTROL]: 'redirect' as const,
    location,
    status,
  });
}

/** Ends a view's loader with the workspace's 404 page. */
export function notFound(): never {
  throw Object.assign(new Error('Not found'), { [VIEW_CONTROL]: 'not-found' as const });
}

export function readViewControl(error: unknown): ViewRedirect | ViewNotFound | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const kind = (error as { [VIEW_CONTROL]?: unknown })[VIEW_CONTROL];
  return kind === 'redirect' || kind === 'not-found'
    ? (error as ViewRedirect | ViewNotFound)
    : undefined;
}

export function isViewRedirect(control: ViewRedirect | ViewNotFound): control is ViewRedirect {
  return control[VIEW_CONTROL] === 'redirect';
}

const FORM_ISSUE = Symbol.for('webstir.webstir-backend.form-issue');

export interface FormIssueControl {
  readonly [FORM_ISSUE]: true;
  readonly field?: string;
  readonly message: string;
  readonly formId?: string;
  readonly values?: Readonly<Record<string, string | string[]>>;
}

/**
 * Ends a form's action with an issue: the form comes back on the page it was sent from, with what
 * was typed and this message, at `field` or, without one, for the whole form. `form` names the
 * form whose state the page reads, when it is not the route's own, such as one form per item;
 * `values` replace some of what was typed, such as a note that a file must be chosen again.
 */
export function fieldIssue(
  field: string | undefined,
  message: string,
  options: {
    readonly form?: string;
    readonly values?: Readonly<Record<string, string | string[]>>;
  } = {},
): never {
  throw Object.assign(new Error(message), {
    [FORM_ISSUE]: true as const,
    ...(field ? { field } : {}),
    ...(options.form ? { formId: options.form } : {}),
    ...(options.values ? { values: options.values } : {}),
    message,
  });
}

export function readFormIssue(error: unknown): FormIssueControl | undefined {
  return error && typeof error === 'object' && (error as { [FORM_ISSUE]?: unknown })[FORM_ISSUE]
    ? (error as FormIssueControl)
    : undefined;
}

/**
 * Whether an error is one of Webstir's own endings (`redirect()`, `notFound()`, `fieldIssue()`), for
 * code that catches errors to pass these on.
 */
export function isWebstirControl(error: unknown): boolean {
  return readViewControl(error) !== undefined || readFormIssue(error) !== undefined;
}
