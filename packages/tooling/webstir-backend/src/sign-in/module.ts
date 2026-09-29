import { z } from 'zod';

import { appUrl, sessionSecret } from '../app/env.js';
import { isProduction } from '../app/app-root.js';
import { email as appEmail, hasEmailDelivery, type EmailMessage } from '../email/index.js';
import { processFormSubmission, type FormIssue, type FormValues } from '../runtime/forms.js';
import { renewSession } from '../runtime/session-metadata.js';
import { redirect } from '../runtime/view-control.js';
import { signInDatabase } from './database.js';
import type { LoadUser } from './guard.js';
import { CODE_MINUTES, consumeCode, consumeToken, createChallenge } from './challenges.js';
import {
  findOrCreateUser,
  normalizeEmail,
  readSessionUserRef,
  SESSION_USER_KEY,
  signOutEverywhere,
  type SessionUser,
} from './users.js';

/** What an app decides about sign-in, in `src/backend/sign-in.ts`. */
export interface SignInOptions {
  /** Who may sign in. By default anyone can, and a first sign-in creates the user. */
  canSignIn?(email: string): boolean | Promise<boolean>;
  /** The email with the code and the link; Webstir's plain one by default. */
  email?(message: SignInEmail): Pick<EmailMessage, 'subject' | 'text' | 'html'>;
  /**
   * `'app'` when the app's own migrations make the `users` table: a text `id`, a unique lowercase
   * `email`, `session_version` and `created_at`, and a default for any other column, since a
   * first sign-in inserts only those. By default Webstir makes it before the app's migrations,
   * so they can reference `users (id)`.
   */
  usersTable?: 'webstir' | 'app';
  /**
   * The app's own user for a signed-in person: `ctx.user` everywhere is what this returns, and
   * `roles` on it is what `auth: { role }` checks. Null means no access: such a person is treated as
   * signed out. By default `ctx.user` is Webstir's `{ id, email }`.
   */
  loadUser?: LoadUser;
}

export interface SignInEmail {
  readonly email: string;
  readonly code: string;
  readonly link: string;
  readonly expiresInMinutes: number;
}

interface FormContext {
  readonly request: Request;
  readonly body: unknown;
  session: Record<string, unknown> | null;
  readonly user?: SessionUser | null;
}

interface ViewContext {
  readonly url: URL;
  readonly session: Record<string, unknown> | null;
  readonly user?: SessionUser | null;
  readonly forms: {
    read(formId: string): { values?: Record<string, unknown>; errors: Record<string, string> };
  };
}

interface HandlerResult {
  status?: number;
  redirect?: { location: string };
  flash?: { level: 'info'; message: string }[];
  rerender?: {
    view: string;
    form: { id: string; values: FormValues; issues: FormIssue[] };
  };
}

const PENDING_KEY = 'webstirSignIn';
const FORM_ID = 'sign-in';
const SIGN_IN_PATH = '/sign-in/';

interface Pending {
  readonly email: string;
  readonly returnTo: string;
  /** Back at the email step to use another address, with this one filled in. */
  readonly changing?: boolean;
}

const signInData = z.object({
  asking: z.boolean(),
  checking: z.boolean(),
  email: z.string(),
  returnTo: z.string(),
  error: z.string(),
  development: z.boolean(),
});

const confirmData = z.object({ token: z.string(), returnTo: z.string() });

const formRoute = (name: string, path: string, formId: string) => ({
  name,
  method: 'POST' as const,
  path,
  interaction: 'navigation' as const,
  session: { mode: 'optional' as const, write: true },
  form: { id: formId, contentType: 'application/x-www-form-urlencoded' as const, csrf: true },
});

export interface SignInModule {
  readonly options: SignInOptions;
  readonly views: readonly unknown[];
  readonly routes: readonly unknown[];
}

/** Email-code sign-in: the sign-in and confirm pages, and the routes their forms post to. */
export function signIn(options: SignInOptions = {}): SignInModule {
  const views = [
    {
      definition: { name: 'sign-in', path: '/sign-in', page: 'sign-in' },
      data: signInData,
      async load(ctx: ViewContext): Promise<z.infer<typeof signInData>> {
        const pending = readPending(ctx.session);
        const form = ctx.forms.read(FORM_ID);
        // A form sent back, such as a link that has expired, keeps where the visitor was headed.
        const returnTo = safeReturnTo(
          ctx.url.searchParams.get('returnTo') ?? form.values?.returnTo ?? pending?.returnTo,
        );
        // Someone already signed in goes on to where they were headed, while they still may sign
        // in: an app that turned them away since would send them straight back here.
        if (ctx.user && (await mayStillSignIn(options, ctx.user.email))) redirect(returnTo);
        const errors = form.errors;
        return {
          asking: !pending || Boolean(pending.changing),
          checking: Boolean(pending && !pending.changing),
          email: pending?.email ?? '',
          returnTo,
          error: errors.code ?? errors.email ?? errors.form ?? '',
          development: !isProduction() && !hasEmailDelivery(),
        };
      },
    },
    {
      definition: { name: 'sign-in-confirm', path: '/sign-in/confirm', page: 'sign-in-confirm' },
      data: confirmData,
      load(ctx: ViewContext): z.infer<typeof confirmData> {
        return {
          token: ctx.url.searchParams.get('token') ?? '',
          returnTo: safeReturnTo(ctx.url.searchParams.get('returnTo')),
        };
      },
    },
  ];

  const routes = [
    {
      definition: formRoute('sign-in-submit', '/sign-in', FORM_ID),
      async handler(ctx: FormContext): Promise<HandlerResult> {
        const submitted = processFormSubmission({
          session: ctx.session,
          body: ctx.body,
          formId: FORM_ID,
          csrf: true,
          redirectTo: SIGN_IN_PATH,
        });
        ctx.session = submitted.session;
        if (!submitted.ok) return submitted.result;
        const values = submitted.values;
        const intent = String(values.intent ?? 'request');
        const pending = readPending(ctx.session);

        if (intent === 'change') {
          ctx.session = withPending(ctx.session, pending && { ...pending, changing: true });
          return seeOther(SIGN_IN_PATH);
        }
        if (intent === 'code') {
          if (!pending || pending.changing) return seeOther(SIGN_IN_PATH);
          const code = readSignInCode(values.code);
          const db = await signInDatabase();
          // Who may sign in is asked again: someone turned away since the code was sent is refused.
          const allowed = Boolean(code) && (await mayStillSignIn(options, pending.email));
          if (!code || !allowed || !(await consumeCode(db, pending.email, code, secret()))) {
            return failed(
              values,
              'code',
              'That code is wrong or has expired. Check the email, or send a new code.',
            );
          }
          return signedIn(ctx, await findOrCreateUser(db, pending.email), pending.returnTo);
        }

        const address = intent === 'resend' ? pending?.email : normalizeEmail(values.email);
        if (!address) {
          return failed(values, 'email', 'Enter your email address.');
        }
        const returnTo = safeReturnTo(values.returnTo ?? pending?.returnTo);
        await sendChallenge(ctx.request, address, returnTo, options);
        ctx.session = withPending(ctx.session, { email: address, returnTo });
        if (intent !== 'resend') return seeOther(SIGN_IN_PATH);
        const where =
          !isProduction() && !hasEmailDelivery()
            ? ' Codes are in the terminal and .webstir/email.log.'
            : '';
        return {
          ...seeOther(SIGN_IN_PATH),
          flash: [
            {
              level: 'info',
              message: `If ${address} can sign in, a code is on its way. A new one can be sent once a minute.${where}`,
            },
          ],
        };
      },
    },
    {
      definition: formRoute('sign-in-confirm-submit', '/sign-in/confirm', 'sign-in-confirm'),
      async handler(ctx: FormContext): Promise<HandlerResult> {
        const submitted = processFormSubmission({
          session: ctx.session,
          body: ctx.body,
          formId: 'sign-in-confirm',
          csrf: true,
          redirectTo: SIGN_IN_PATH,
        });
        ctx.session = submitted.session;
        if (!submitted.ok) return submitted.result;
        const db = await signInDatabase();
        const address = await consumeToken(db, String(submitted.values.token ?? ''), secret());
        if (!address || !(await mayStillSignIn(options, address))) {
          return failed(
            submitted.values,
            'form',
            'This link has expired or was already used. Send yourself a new code.',
          );
        }
        return signedIn(
          ctx,
          await findOrCreateUser(db, address),
          safeReturnTo(submitted.values.returnTo),
        );
      },
    },
    {
      definition: formRoute('sign-out', '/sign-out', 'sign-out'),
      async handler(ctx: FormContext): Promise<HandlerResult> {
        // A sign-out form can sit on any page, rendered or not, so it is checked by its origin.
        if (!isSameOrigin(ctx.request)) return { status: 403 };
        const values = new URLSearchParams(
          typeof ctx.body === 'object' && ctx.body ? (ctx.body as Record<string, string>) : {},
        );
        const ref = readSessionUserRef(ctx.session);
        if (ref && values.get('everywhere'))
          await signOutEverywhere(await signInDatabase(), ref.id);
        ctx.session = null;
        return seeOther('/');
      },
    },
  ];

  return { options, views, routes };
}

/** The app's module with sign-in's views and routes added, marked so the server knows. */
export function withSignIn<T extends Record<string, unknown>>(
  appModule: T | undefined,
  signInModule: SignInModule | SignInOptions,
): T & { signIn: SignInOptions } {
  const built =
    'views' in signInModule && 'routes' in signInModule
      ? signInModule
      : signIn(signInModule as SignInOptions);
  const base = (appModule ?? {}) as Record<string, unknown>;
  const manifest = base.manifest as Record<string, unknown> | undefined;
  const definitions = (items: readonly unknown[]) =>
    items.map((item) => (item as { definition: unknown }).definition);
  return {
    ...base,
    ...(manifest
      ? {
          manifest: {
            ...manifest,
            views: [...((manifest.views as unknown[]) ?? []), ...definitions(built.views)],
            routes: [...((manifest.routes as unknown[]) ?? []), ...definitions(built.routes)],
          },
        }
      : {}),
    views: [...((base.views as unknown[]) ?? []), ...built.views],
    routes: [...((base.routes as unknown[]) ?? []), ...built.routes],
    signIn: built.options,
  } as unknown as T & { signIn: SignInOptions };
}

/**
 * The six digits of a code, typed with spaces or dashes, or pasted with the email's words around
 * it; undefined when there are not six.
 */
export function readSignInCode(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value : '';
  const run = /(?:^|\D)(\d{6})(?!\d)/.exec(text);
  if (run) return run[1];
  const spaced = /(?:^|\D)((?:\d[\s-]*){5}\d)(?![\s-]*\d)/.exec(text);
  const digits = spaced?.[1]?.replace(/\D/g, '');
  return digits?.length === 6 ? digits : undefined;
}

/** A same-origin path to return to after signing in; never another site, and never sign-in itself. */
export function safeReturnTo(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '/';
  const text = raw.trim();
  if (!text.startsWith('/') || text.startsWith('//') || text.includes('\\')) return '/';
  try {
    const url = new URL(text, 'http://app.invalid');
    if (url.origin !== 'http://app.invalid') return '/';
    // Checked again after normalizing: `/.//x` and `/a/..//x` become `//x`, another site.
    const result = `${url.pathname}${url.search}${url.hash}`;
    if (result.startsWith('//') || result.includes('\\')) return '/';
    if (/^\/sign-(?:in|out)(?:\/|$)/.test(url.pathname)) return '/';
    return result;
  } catch {
    return '/';
  }
}

async function mayStillSignIn(options: SignInOptions, address: string): Promise<boolean> {
  return (await options.canSignIn?.(address)) ?? true;
}

async function sendChallenge(
  request: Request,
  address: string,
  returnTo: string,
  options: SignInOptions,
): Promise<void> {
  const allowed = (await options.canSignIn?.(address)) ?? true;
  // The same answer, after the same work, whether or not the address may sign in or asked too often.
  const challenge = await createChallenge(await signInDatabase(), address, secret(), new Date(), {
    allowed,
  });
  if (!challenge) return;
  const link = `${appUrl(request)}/sign-in/confirm/?token=${encodeURIComponent(challenge.token)}&returnTo=${encodeURIComponent(returnTo)}`;
  const message = { email: address, code: challenge.code, link, expiresInMinutes: CODE_MINUTES };
  const content = options.email?.(message) ?? defaultEmail(message);
  // Sent without waiting, so the answer takes as long whether or not an email goes out; a failure
  // is for the server's log, never the page.
  void appEmail.send({ to: address, ...content }).catch((error: unknown) => {
    console.error(
      `[sign-in] could not send the code to ${address}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

function defaultEmail(message: SignInEmail): Pick<EmailMessage, 'subject' | 'text'> {
  return {
    subject: `Your sign-in code: ${message.code}`,
    text: `Your sign-in code is ${message.code}. It works for ${message.expiresInMinutes} minutes.\n\nOr sign in with this link:\n${message.link}\n\nIf you did not ask to sign in, you can ignore this email.\n`,
  };
}

function signedIn(
  ctx: FormContext,
  user: { id: string; version: number },
  returnTo: string,
): HandlerResult {
  // A new session id at sign-in, so one set before it cannot be used to ride along.
  ctx.session = renewSession({ [SESSION_USER_KEY]: { id: user.id, version: user.version } });
  return seeOther(returnTo);
}

function failed(values: FormValues, field: string, message: string): HandlerResult {
  return {
    status: 422,
    rerender: {
      view: 'sign-in',
      form: { id: FORM_ID, values, issues: [{ code: 'validation', field, message }] },
    },
  };
}

function seeOther(location: string): HandlerResult {
  return { status: 303, redirect: { location } };
}

function readPending(session: Record<string, unknown> | null): Pending | undefined {
  const value = session?.[PENDING_KEY] as Partial<Pending> | undefined;
  return value && typeof value.email === 'string'
    ? {
        email: value.email,
        returnTo: safeReturnTo(value.returnTo),
        ...(value.changing === true ? { changing: true } : {}),
      }
    : undefined;
}

function withPending(
  session: Record<string, unknown> | null,
  pending: Pending | undefined,
): Record<string, unknown> {
  // Changed in place: the session object also carries its id and form state.
  const next = session ?? {};
  if (pending) next[PENDING_KEY] = pending;
  else delete next[PENDING_KEY];
  return next;
}

function secret(): string {
  return `${sessionSecret()}:sign-in`;
}

function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('x-forwarded-host') ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
