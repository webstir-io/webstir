import { refererPath } from '../sign-in/guard.js';
import { normalizePath } from './core.js';
import {
  formFailure,
  hasSessionCsrfToken,
  readFormValues,
  type FormIssue,
  type FormRerenderTarget,
  type FormSubmissionResult,
  type FormValues,
} from './forms.js';
import { matchView, type CompiledView } from './views.js';

interface DeclaredFormRoute {
  readonly name?: string;
  readonly path?: string;
  readonly form?: { readonly id?: string; readonly csrf?: boolean };
}

/** Where a form that failed goes back to: the app page it was sent from, if it came from one. */
interface FormReturn {
  /** The view that renders that page, to render it again with the form's issues. */
  readonly rerender?: FormRerenderTarget;
  /** That page, for the form's issues to wait for, when no view renders it. */
  readonly redirectTo?: string;
}

function formReturn(request: Request, views: readonly CompiledView[]): FormReturn {
  const pageView = (location: string) => {
    const pathname = normalizePath(new URL(location, 'http://app.invalid').pathname);
    const match = matchView(views, pathname);
    return match?.view.definition?.page
      ? { view: match.view.name, params: match.params }
      : undefined;
  };
  // The page the form was on, from the Referer a browser sends; or, when it sends none (a
  // no-referrer policy), the page at the address the form posted to, as forms often post to their
  // own page's address.
  const referer = sameAppReferer(request) ? refererPath(request) : undefined;
  const target = (referer && pageView(referer)) ?? pageView(new URL(request.url).pathname);
  if (target) return { rerender: target };
  // Without a page of the app's to go back to, the failure is answered where it happened.
  return referer ? { redirectTo: referer } : {};
}

function sameAppReferer(request: Request): boolean {
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    const host = request.headers.get('x-forwarded-host') ?? new URL(request.url).host;
    return new URL(referer).host === host;
  } catch {
    return false;
  }
}

/** A route's form id, which the page's loader reads with `ctx.forms.read(id)`: `form.id`, or its name. */
export function declaredFormId(route: DeclaredFormRoute): string {
  return route.form?.id ?? route.name ?? route.path ?? 'form';
}

/**
 * Checks a submission to a route that declares `form` before its handler runs: a CSRF token its
 * session issued, when the route asks for one, and the values parsed. A failure goes back to the
 * page it came from, rendered again with the issue, or is answered 403 when it came from nowhere.
 */
export function checkDeclaredForm<TSession extends Record<string, unknown>>(options: {
  request: Request;
  views: readonly CompiledView[];
  route: DeclaredFormRoute;
  session: TSession | null;
  body: unknown;
  now: () => Date;
}): FormSubmissionResult<TSession, never> {
  const values = readFormValues(options.body);
  if (!options.route.form?.csrf || hasSessionCsrfToken(options.session, options.body)) {
    return {
      ok: true,
      session: options.session ?? ({} as TSession),
      values,
      auth: undefined as never,
    };
  }
  const back = formReturn(options.request, options.views);
  return formFailure({
    session: options.session,
    formId: declaredFormId(options.route),
    values,
    issues: [{ code: 'csrf', message: 'Form session expired. Reload the page and try again.' }],
    rerender: back.rerender,
    redirectTo: back.redirectTo,
    now: options.now,
  });
}

/** The answer to a `fieldIssue` thrown from a form's action: the form back where it came from. */
export function failDeclaredForm<TSession extends Record<string, unknown>>(options: {
  request: Request;
  views: readonly CompiledView[];
  session: TSession | null;
  formId: string;
  values: FormValues;
  issue: FormIssue;
  now: () => Date;
}) {
  const back = formReturn(options.request, options.views);
  return formFailure({
    session: options.session,
    formId: options.formId,
    values: options.values,
    issues: [options.issue],
    rerender: back.rerender,
    redirectTo: back.redirectTo,
    now: options.now,
  });
}
