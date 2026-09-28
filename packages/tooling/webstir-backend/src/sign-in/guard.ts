import { signInDatabase } from './database.js';
import {
  loadSessionUser,
  readSessionUserRef,
  SESSION_USER_KEY,
  type SessionUser,
} from './users.js';

/**
 * The session's signed-in user, re-checked against the database: a user signed out everywhere, or
 * gone, is no longer the session's, and the session forgets them.
 */
export async function resolveSessionUser(
  session: Record<string, unknown> | null,
): Promise<SessionUser | null> {
  const ref = readSessionUserRef(session);
  if (!ref) return null;
  const user = await loadSessionUser(await signInDatabase(), ref);
  if (!user && session) delete session[SESSION_USER_KEY];
  return user ?? null;
}

export function requiresSignIn(definition: { readonly auth?: unknown } | undefined): boolean {
  return definition?.auth === 'required';
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

function refererPath(request: Request): string {
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
