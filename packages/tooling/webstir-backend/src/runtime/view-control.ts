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
