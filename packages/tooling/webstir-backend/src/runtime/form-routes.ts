import { FORM_ID_FIELD, FORM_PAGE_FIELD } from '@webstir-io/module-contract';

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

/** What a posted form says about itself: the page it was rendered on, and the state it fails to. */
export interface PostedForm {
  readonly page?: string;
  readonly formId?: string;
}

const POSTED_FORM_ID = /^[\w:.-]{1,120}$/;

/**
 * The page and form id a form carries, taken out of the body so actions never see them. The page
 * is kept only as a path on this app; the id only when it is a plain name.
 */
export function takePostedForm(body: unknown): PostedForm {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const record = body as Record<string, unknown>;
  const page = record[FORM_PAGE_FIELD];
  const formId = record[FORM_ID_FIELD];
  delete record[FORM_PAGE_FIELD];
  delete record[FORM_ID_FIELD];
  return {
    ...(typeof page === 'string' && /^\/(?![/\\])/.test(page) && !page.includes('\\')
      ? { page }
      : {}),
    ...(typeof formId === 'string' && POSTED_FORM_ID.test(formId) ? { formId } : {}),
  };
}

function formReturn(
  request: Request,
  views: readonly CompiledView[],
  posted: PostedForm = {},
): FormReturn {
  const pageView = (location: string) => {
    const pathname = normalizePath(new URL(location, 'http://app.invalid').pathname);
    const match = matchView(views, pathname);
    return match?.view.definition?.page
      ? { view: match.view.name, params: match.params }
      : undefined;
  };
  // The page the form was on: the address it was rendered with, then the Referer a browser sends
  // (which, after one failed post, names that post's address instead), then the address the form
  // posted to, as forms often post to their own page's address.
  const referer = sameAppReferer(request) ? refererPath(request) : undefined;
  const target =
    (posted.page && pageView(posted.page)) ??
    (referer && pageView(referer)) ??
    pageView(new URL(request.url).pathname);
  if (target) return { rerender: target };
  // Without a page of the app's to go back to, the failure is answered where it happened.
  const back = posted.page ?? referer;
  return back ? { redirectTo: back } : {};
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

/**
 * A submission's form id, which the page's loader reads with `ctx.forms.read(id)`: the one the form
 * names itself (one form per item), else the route's `form.id`, else its name.
 */
export function declaredFormId(route: DeclaredFormRoute, posted: PostedForm = {}): string {
  return posted.formId ?? route.form?.id ?? route.name ?? route.path ?? 'form';
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
  posted: PostedForm;
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
  const back = formReturn(options.request, options.views, options.posted);
  return formFailure({
    session: options.session,
    formId: declaredFormId(options.route, options.posted),
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
  posted: PostedForm;
  session: TSession | null;
  formId: string;
  values: FormValues;
  issue: FormIssue;
  now: () => Date;
}) {
  const back = formReturn(options.request, options.views, options.posted);
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
