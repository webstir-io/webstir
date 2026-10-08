import { appUrl } from '../app/env.js';
import { processFormSubmission } from '../runtime/forms.js';
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
  readonly body?: unknown;
  session: Record<string, unknown> | null;
}

interface RouteResult {
  status?: number;
  redirect?: { location: string };
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

/** The id of the form on the sign-in page that starts sign-in through a provider. */
export function providerFormId(id: string): string {
  return `sign-in-${id}`;
}

/**
 * Each provider's two routes. The sign-in page's form posts to the first, which sends the visitor
 * to the provider; a form, so that nothing but a visitor's own click starts it. The provider sends
 * them back to the second, which signs in who it says came back.
 */
export function providerRoutes(options: SignInOptions): unknown[] {
  return (options.providers ?? []).flatMap((provider) => {
    const callback = (request: Request) => `${appUrl(request)}/sign-in/${provider.id}/callback/`;
    const unfinished = (why: unknown): RouteResult => {
      console.error(
        `[sign-in] ${provider.id}: ${oneLine(why instanceof Error ? why.message : String(why))}`,
      );
      return refused(`Signing in with ${provider.label} did not finish. Try again.`);
    };
    const noAccess = (why: string): RouteResult => {
      console.error(`[sign-in] ${provider.id}: ${oneLine(why)}`);
      return refused(NO_ACCESS);
    };

    return [
      {
        definition: {
          name: `sign-in-${provider.id}`,
          method: 'POST' as const,
          path: `/sign-in/${provider.id}`,
          interaction: 'navigation' as const,
          session: { mode: 'optional' as const, write: true },
          form: {
            id: providerFormId(provider.id),
            contentType: 'application/x-www-form-urlencoded' as const,
            csrf: true,
          },
        },
        async handler(ctx: RouteContext): Promise<RouteResult> {
          const submitted = processFormSubmission({
            session: ctx.session,
            body: ctx.body,
            formId: providerFormId(provider.id),
            csrf: true,
            redirectTo: SIGN_IN_PATH,
          });
          ctx.session = submitted.session;
          if (!submitted.ok) return submitted.result;
          const returnTo = safeReturnTo(submitted.values.returnTo);
          let started: Awaited<ReturnType<SignInProvider['start']>>;
          try {
            started = await provider.start({ redirectUri: callback(ctx.request) });
            if (
              typeof started?.location !== 'string' ||
              !started.location ||
              typeof started.keep !== 'object' ||
              !started.keep
            ) {
              throw new Error('its start gave no location to go to, or nothing to keep');
            }
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
        definition: {
          name: `sign-in-${provider.id}-callback`,
          method: 'GET' as const,
          path: `/sign-in/${provider.id}/callback`,
          interaction: 'navigation' as const,
          session: { mode: 'optional' as const, write: true },
        },
        async handler(ctx: RouteContext): Promise<RouteResult> {
          // Used once: an answer replayed, or one nobody here asked for, finds nothing waiting.
          const waiting = takeWaiting(ctx.session, provider.id);
          if (!waiting) {
            return unfinished(
              'an answer came back with no sign-in waiting for it in the session. The session cookie did not come with it: it expired, or APP_URL is not the address the visitor used.',
            );
          }
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
          const vouched = normalizeEmail(identity.email);
          // Someone who signed in before is the user they were, whatever address they have now.
          const email = known?.email ?? vouched;
          if (!email) return noAccess('the provider gave no address to know a new person by');
          // Asked about the address the app knows them by, and the one the provider gives now:
          // a person turned away under either is turned away.
          for (const address of new Set([email, vouched ?? email])) {
            if (!((await options.canSignIn?.(address)) ?? true)) {
              return noAccess(`canSignIn turned ${address} away`);
            }
          }
          const user =
            known ??
            (await linkIdentity(
              db,
              { provider: provider.id, subject, email },
              { create: provider.allowSignUp ?? true },
            ));
          if (!user) {
            return noAccess(
              `${email} is not a user who can be signed in this way: sign-up is off and they are new, or they already sign in here as someone else at ${provider.label}`,
            );
          }
          ctx.session = signedInSession(user);
          return seeOther(waiting.returnTo);
        },
      },
    ];
  });
}

/** Refuses options nobody could sign in with, or providers the routes could not be made from. */
export function checkSignInMethods(options: SignInOptions): void {
  const providers = options.providers ?? [];
  if (options.emailCode === false && providers.length === 0) {
    throw new Error(
      '[sign-in] emailCode is off and there are no providers, so nobody could sign in.',
    );
  }
  const seen = new Set<string>();
  for (const provider of providers) {
    const id = (provider as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id) || id === 'confirm') {
      throw new Error(
        `[sign-in] a provider's id is in its addresses, so ${JSON.stringify(id)} cannot be one: use lowercase letters, digits and dashes, and not "confirm".`,
      );
    }
    if (seen.has(id)) throw new Error(`[sign-in] two providers have the id "${id}".`);
    seen.add(id);
    if (
      typeof provider.label !== 'string' ||
      !provider.label.trim() ||
      typeof provider.start !== 'function' ||
      typeof provider.finish !== 'function'
    ) {
      throw new Error(
        `[sign-in] the provider "${id}" needs a label, and start and finish functions.`,
      );
    }
  }
}

/**
 * A reason as one line of the log: part of it may be what a provider, or the address a visitor
 * came back at, said went wrong, and neither gets to write lines of its own.
 */
export function oneLine(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed
  const line = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').trim();
  return line.length > 500 ? `${line.slice(0, 500)}...` : line;
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
