import { signInDatabase } from './database.js';
import {
  loadSessionUser,
  readSessionUserRef,
  SESSION_USER_KEY,
  type SessionUser,
} from './users.js';

/** The app's own user for a signed-in person, or null when they have no access to the app. */
export type LoadUser = (user: SessionUser) => Promise<AppUserLike | null> | AppUserLike | null;

interface AppUserLike {
  readonly id: string;
  readonly email: string;
  readonly roles?: readonly string[];
}

/**
 * The session's signed-in user, re-checked against the database: a user signed out everywhere, or
 * gone, is no longer the session's, and the session forgets them. With `loadUser`, the user is the
 * app's own, and someone it gives no access to is nobody.
 */
export async function resolveSessionUser(
  session: Record<string, unknown> | null,
  loadUser?: LoadUser,
): Promise<AppUserLike | null> {
  const ref = readSessionUserRef(session);
  if (!ref) return null;
  const user = await loadSessionUser(await signInDatabase(), ref);
  if (!user) {
    if (session) delete session[SESSION_USER_KEY];
    return null;
  }
  return loadUser ? ((await loadUser(user)) ?? null) : user;
}

export function requiresSignIn(definition: { readonly auth?: unknown } | undefined): boolean {
  return definition?.auth === 'required' || requiredRole(definition) !== undefined;
}

/** The role a route or view requires, from `auth: { role }`. */
export function requiredRole(
  definition: { readonly auth?: unknown } | undefined,
): string | undefined {
  const auth = definition?.auth;
  return auth && typeof auth === 'object' && typeof (auth as { role?: unknown }).role === 'string'
    ? (auth as { role: string }).role
    : undefined;
}

/** Whether a signed-in user may reach a route or view: it needs no role, or they have it. */
export function hasRequiredRole(
  user: { readonly roles?: readonly string[] },
  definition: { readonly auth?: unknown } | undefined,
): boolean {
  const role = requiredRole(definition);
  return role === undefined || (user.roles ?? []).includes(role);
}

/** Where a signed-out visitor goes: sign-in, then back to the page they wanted. */
export function signInLocation(returnTo: string): string {
  return `/sign-in/?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * The answer to a signed-out request for a route that needs sign-in: a browser (a form, or a page
 * request) is sent to sign in and back to the page it came from; an API call gets 401.
 */
export function signInRequired(
  request: Request,
  route: { readonly form?: unknown } | undefined,
): {
  status: number;
  redirect?: { location: string };
  errors?: { code: string; message: string }[];
} {
  const accept = request.headers.get('accept') ?? '';
  if (route?.form || accept.includes('text/html')) {
    return { status: 303, redirect: { location: signInLocation(refererPath(request)) } };
  }
  return {
    status: 401,
    errors: [{ code: 'sign_in_required', message: 'Sign in to use this.' }],
  };
}

/** The app page a request came from, from its Referer, or `/` when it came from elsewhere. */
export function refererPath(request: Request): string {
  const referer = request.headers.get('referer');
  if (!referer) return '/';
  try {
    const url = new URL(referer);
    const host = request.headers.get('x-forwarded-host') ?? new URL(request.url).host;
    return url.host === host ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}
