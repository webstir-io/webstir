import type { FormStateReader, FormValues } from '@webstir-io/module-contract';

import type { Database } from '../db/database.js';
import type { Email } from '../email/index.js';
import type { Files } from '../files/index.js';
import type { Jobs } from '../jobs/index.js';
import type { EnvAccessor } from './core.js';
import type { LoggerLike } from './views.js';
import type { RuntimeLogger } from './bun.js';

/**
 * The signed-in person, as `ctx.user` has them: Webstir's user by default, or what the app's
 * sign-in `loadUser` returns. `roles` is what `auth: { role }` checks.
 */
export interface AppUser {
  readonly id: string;
  readonly email: string;
  readonly roles?: readonly string[];
}

/** What a view's loader receives. */
export interface ViewContext<
  TUser extends AppUser = AppUser,
  TParams extends Record<string, string> = Record<string, string>,
> {
  readonly url: URL;
  readonly params: TParams;
  readonly cookies: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly session: Record<string, unknown> | null;
  /** The signed-in user, when the app has sign-in; null when nobody with access is signed in. */
  readonly user: TUser | null;
  /** Failed submissions of the page's forms, by form id. */
  readonly forms: FormStateReader;
  readonly db: Database;
  readonly files: Files;
  readonly email: Email;
  readonly jobs: Jobs;
  readonly env: EnvAccessor;
  readonly logger: LoggerLike;
  readonly requestId?: string;
  readonly now: () => Date;
}

/** A submitted form, as the runtime checked and parsed it for a route that declares `form`. */
export interface SubmittedForm {
  /** The form's id: the route's name, unless the handler reads another with `ctx.forms`. */
  readonly id: string;
  readonly values: FormValues;
}

/** What a route's handler receives. */
export interface ActionContext<
  TUser extends AppUser = AppUser,
  TParams extends Record<string, string> = Record<string, string>,
> {
  readonly request: Request;
  readonly params: TParams;
  readonly query: Record<string, string>;
  readonly body: unknown;
  /** The submitted form, for a route that declares `form`; its CSRF token is already checked. */
  readonly form?: SubmittedForm;
  /** The session; assign to it, or to its fields, to change what the response commits. */
  session: Record<string, unknown> | null;
  readonly user: TUser | null;
  readonly db: Database;
  readonly files: Files;
  readonly email: Email;
  readonly jobs: Jobs;
  /** This request's own scratch space, for request hooks and the handler to hand values along. */
  readonly locals: Record<string, unknown>;
  readonly env: EnvAccessor;
  readonly logger: RuntimeLogger;
  readonly requestId: string;
  readonly now: () => Date;
}
