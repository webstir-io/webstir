import {
  createFormState,
  ensureSessionCsrfToken,
  readFormState,
  type FormRerender,
} from './forms.js';
import {
  findView,
  renderRequestTimeView,
  type CompiledView,
  type EnvAccessorLike,
  type FormStateReaderLike,
  type LoggerLike,
  type ViewFlashMessage,
} from './views.js';

export function createSessionFormReader(
  getSession: () => Record<string, unknown> | null,
): FormStateReaderLike {
  return { read: (formId) => readFormState(getSession(), formId) };
}

/**
 * Renders the view an action named after its form failed, with the submitted values and
 * issues visible to that view's loader through `forms.read`. The view renders at its own
 * address, keeping the posted query, and reports that address so the response can name it.
 */
export async function renderFormRerender<TSession extends Record<string, unknown>>(options: {
  readonly rerender: FormRerender;
  readonly views: readonly CompiledView[];
  readonly workspaceRoot?: string;
  readonly url: URL;
  readonly routeParams: Record<string, string>;
  readonly cookies: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly auth: unknown;
  readonly session: TSession | null;
  readonly env: EnvAccessorLike;
  readonly logger: LoggerLike;
  readonly requestId?: string;
  readonly now: () => Date;
  /** Messages this page shows: those the action consumed, then those it returned. */
  readonly flash?: readonly ViewFlashMessage[];
}): Promise<{ html: string; session: TSession | null; location: string }> {
  const { rerender } = options;
  const view = findView(options.views, rerender.view);
  if (!view) {
    throw new Error(
      `Form ${rerender.form.id} names view "${rerender.view}", which does not exist.`,
    );
  }
  if (!view.definition?.page) {
    throw new Error(
      `Form ${rerender.form.id} re-renders view "${rerender.view}", which has no page to render.`,
    );
  }

  const params = rerender.params ?? options.routeParams;
  const url = viewUrl(view, params, options.url, rerender.form.id);
  let session = options.session;
  const failed = createFormState(rerender.form.values, rerender.form.issues);
  const rendered = await renderRequestTimeView({
    workspaceRoot: options.workspaceRoot,
    url,
    view,
    params,
    cookies: options.cookies,
    headers: options.headers,
    auth: options.auth,
    session,
    env: options.env,
    logger: options.logger,
    requestId: options.requestId,
    now: options.now,
    flash: options.flash ?? [],
    csrfToken: () => {
      const ensured = ensureSessionCsrfToken(session);
      session = ensured.session;
      return ensured.token;
    },
    forms: {
      read: (formId) => (formId === rerender.form.id ? failed : readFormState(session, formId)),
    },
  });
  return { html: rendered.html, session, location: `${url.pathname}${url.search}` };
}

/**
 * The view's own address, with its parameters filled in and the posted query kept. A parameter
 * the action cannot supply is a mistake in the action, not a reason to report the post's address.
 */
function viewUrl(
  view: CompiledView,
  params: Record<string, string>,
  posted: URL,
  formId: string,
): URL {
  const pattern = view.definition?.path;
  if (!pattern) return posted;
  const segments: string[] = [];
  for (const segment of pattern.split('/')) {
    if (!segment.startsWith(':')) {
      segments.push(segment);
      continue;
    }
    const value = params[segment.slice(1)];
    if (value === undefined) {
      throw new Error(
        `Form ${formId} re-renders view "${view.name}", whose path ${pattern} needs \`${segment.slice(1)}\`; pass it in rerender.params.`,
      );
    }
    segments.push(encodeURIComponent(value));
  }
  const url = new URL(segments.join('/'), posted);
  url.search = posted.search;
  return url;
}
