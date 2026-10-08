import { appUrl } from '../app/env.js';
import { signInDatabase } from './database.js';
import { findIdentityUser, linkIdentity } from './identities.js';
import type { SignInOptions } from './module.js';
import { safeReturnTo } from './return-to.js';
import { normalizeEmail, signedInSession } from './users.js';

/** Who a provider says signed in. */
export interface SignInIdentity {
  /** The provider's own lasting id for the person; it stays the same when their email changes. */
  readonly subject: string;
  /**
   * An address the provider vouches for. A first sign-in becomes the user with this address, so
   * a provider must never pass on one the person only claimed.
   */
  readonly email: string;
}

/** A way to sign in through another service, such as an OpenID Connect provider. */
export interface SignInProvider {
  /** In the addresses: `/sign-in/<id>/` and `/sign-in/<id>/callback/`. Lowercase letters, digits and dashes. */
  readonly id: string;
  /** On the sign-in page: "Sign in with <label>". */
  readonly label: string;
  /** Whether a first sign-in may create the user. True by default, as with email codes. */
  readonly allowSignUp?: boolean;
  /** What the provider still needs in production, named, or undefined when it is ready. */
  setupProblem?(): string | undefined;
  /** Where to send the visitor, and what to keep in their session until they come back. */
  start(request: {
    readonly redirectUri: string;
  }): Promise<{ readonly location: string; readonly keep: Record<string, unknown> }>;
  /** Who came back, from the address they came back to. Throws when the answer cannot be trusted. */
  finish(request: {
    readonly url: URL;
    readonly redirectUri: string;
    readonly kept: Record<string, unknown>;
  }): Promise<SignInIdentity>;
}

interface RouteContext {
  readonly request: Request;
  session: Record<string, unknown> | null;
}

interface RouteResult {
  status: number;
  redirect: { location: string };
  flash?: { level: 'error'; message: string }[];
}

interface Waiting {
  readonly returnTo: string;
  readonly kept: Record<string, unknown>;
}

const WAITING_KEY = 'webstirSignInProvider';
const SIGN_IN_PATH = '/sign-in/';
const NO_ACCESS = 'That account cannot sign in here.';

export function providerPath(id: string): string {
  return `${SIGN_IN_PATH}${id}/`;
}

/** Each provider's two routes: one sends the visitor to it, the other signs in who comes back. */
export function providerRoutes(options: SignInOptions): unknown[] {
  return (options.providers ?? []).flatMap((provider) => {
    const route = (name: string, path: string) => ({
      name: `sign-in-${provider.id}${name}`,
      method: 'GET' as const,
      path,
      interaction: 'navigation' as const,
      session: { mode: 'optional' as const, write: true },
    });
    const callback = (request: Request) => `${appUrl(request)}/sign-in/${provider.id}/callback/`;
    const unfinished = (error?: unknown): RouteResult => {
      if (error !== undefined) {
        console.error(
          `[sign-in] ${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return refused(`Signing in with ${provider.label} did not finish. Try again.`);
    };

    return [
      {
        definition: route('', `/sign-in/${provider.id}`),
        async handler(ctx: RouteContext): Promise<RouteResult> {
          const returnTo = safeReturnTo(new URL(ctx.request.url).searchParams.get('returnTo'));
          let started: Awaited<ReturnType<SignInProvider['start']>>;
          try {
            started = await provider.start({ redirectUri: callback(ctx.request) });
          } catch (error) {
            return unfinished(error);
          }
          // Changed in place: the session object also carries its id and form state.
          const session = ctx.session ?? {};
          session[WAITING_KEY] = { provider: provider.id, returnTo, kept: started.keep };
          ctx.session = session;
          return seeOther(started.location);
        },
      },
      {
        definition: route('-callback', `/sign-in/${provider.id}/callback`),
        async handler(ctx: RouteContext): Promise<RouteResult> {
          // Used once: an answer replayed, or one nobody here asked for, finds nothing waiting.
          const waiting = takeWaiting(ctx.session, provider.id);
          if (!waiting) return unfinished();
          let identity: SignInIdentity;
          try {
            identity = await provider.finish({
              url: new URL(ctx.request.url),
              redirectUri: callback(ctx.request),
              kept: waiting.kept,
            });
          } catch (error) {
            return unfinished(error);
          }
          const subject = typeof identity?.subject === 'string' ? identity.subject.trim() : '';
          if (!subject) return unfinished('the provider named nobody');

          const db = await signInDatabase();
          const known = await findIdentityUser(db, provider.id, subject);
          // Someone who signed in before is the user they were, whatever address they have now.
          const email = known?.email ?? normalizeEmail(identity.email);
          if (!email || !((await options.canSignIn?.(email)) ?? true)) return refused(NO_ACCESS);
          const user =
            known ??
            (await linkIdentity(
              db,
              { provider: provider.id, subject, email },
              { create: provider.allowSignUp ?? true },
            ));
          if (!user) return refused(NO_ACCESS);
          ctx.session = signedInSession(user);
          return seeOther(waiting.returnTo);
        },
      },
    ];
  });
}

/** Refuses options nobody could sign in with, or whose providers' addresses would collide. */
export function checkSignInMethods(options: SignInOptions): void {
  const providers = options.providers ?? [];
  if (options.emailCode === false && providers.length === 0) {
    throw new Error(
      '[sign-in] emailCode is off and there are no providers, so nobody could sign in.',
    );
  }
  const seen = new Set<string>();
  for (const { id } of providers) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || id === 'confirm') {
      throw new Error(
        `[sign-in] a provider's id is in its addresses, so "${id}" cannot be one: use lowercase letters, digits and dashes, and not "confirm".`,
      );
    }
    if (seen.has(id)) throw new Error(`[sign-in] two providers have the id "${id}".`);
    seen.add(id);
  }
}

function takeWaiting(
  session: Record<string, unknown> | null,
  provider: string,
): Waiting | undefined {
  const value = session?.[WAITING_KEY] as
    | { provider?: unknown; returnTo?: unknown; kept?: unknown }
    | undefined;
  if (session) delete session[WAITING_KEY];
  return value && value.provider === provider && typeof value.kept === 'object' && value.kept
    ? { returnTo: safeReturnTo(value.returnTo), kept: value.kept as Record<string, unknown> }
    : undefined;
}

function refused(message: string): RouteResult {
  return { ...seeOther(SIGN_IN_PATH), flash: [{ level: 'error', message }] };
}

function seeOther(location: string): RouteResult {
  return { status: 303, redirect: { location } };
}
