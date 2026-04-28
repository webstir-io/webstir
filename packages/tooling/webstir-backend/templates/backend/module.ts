// Example manifest + route definition. Update the values to match your backend.
// When this file is present, the server scaffold loads build/backend/module.js,
// announces the manifest, and mounts every route definition automatically.

import {
  groupFormIssuesByField,
  prepareFormState,
  processFormSubmission,
  type FormIssue,
  type FormValues,
} from '@webstir-io/webstir-backend/runtime/forms';

interface RouteHandlerResult {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  redirect?: {
    location: string;
  };
  errors?: { code: string; message: string; details?: unknown }[];
}

interface RouteContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  session: Record<string, unknown> | null;
  flash: readonly {
    key: string;
    level: 'info' | 'success' | 'warning' | 'error';
    createdAt: string;
  }[];
  db: Record<string, unknown>;
  auth?: {
    userId?: string;
    email?: string;
    scopes: readonly string[];
    roles: readonly string[];
  };
  requestId: string;
  env: {
    get: (name: string) => string | undefined;
    require: (name: string) => string;
    entries: () => Record<string, string | undefined>;
  };
  logger: {
    info: (message: string, metadata?: Record<string, unknown>) => void;
    warn: (message: string, metadata?: Record<string, unknown>) => void;
    error: (message: string, metadata?: Record<string, unknown>) => void;
  };
  now: () => Date;
}

type RequestHook = {
  id: string;
  handler:
    | ((ctx: RouteContext) => Promise<RouteHandlerResult | undefined>)
    | ((ctx: RouteContext) => RouteHandlerResult | undefined);
};

const accountSettingsPageDefinition = {
  name: 'accountSettingsPage',
  method: 'GET',
  path: '/account/settings',
  interaction: 'navigation',
  session: { mode: 'optional' },
  flash: { consume: ['settings-saved'] },
  summary: 'Account settings form',
  description:
    'Demonstrates HTML-first form rendering with CSRF, redirect-after-post, and inline validation.',
} as const;

const updateAccountSettingsDefinition = {
  name: 'accountSettingsUpdate',
  method: 'POST',
  path: '/account/settings',
  interaction: 'mutation',
  form: {
    contentType: 'application/x-www-form-urlencoded',
    csrf: true,
    session: { write: true },
    flash: {
      publish: [{ key: 'settings-saved', level: 'success', when: 'success' }],
    },
  },
  summary: 'Update account settings',
  description: 'Demonstrates auth-aware mutations and redirect-after-post ergonomics.',
} as const;

const routes = [
  {
    definition: {
      name: 'helloRoute',
      method: 'GET',
      path: '/hello/:name',
      requestHooks: [{ id: 'audit-hello' }],
      summary: 'Simple hello route',
      description: 'Demonstrates manifest wiring + request context metadata.',
    },
    handler: async (ctx: RouteContext) => {
      if (!ctx.auth) {
        return {
          status: 401,
          errors: [{ code: 'auth', message: 'Sign-in required to access /hello' }],
        };
      }
      const name = ctx.params.name ?? 'world';
      ctx.logger.info('hello route invoked', {
        name,
        requestId: ctx.requestId,
        userId: ctx.auth.userId,
      });
      return {
        status: 200,
        body: {
          message: `Hello ${name}`,
          greetedAt: ctx.now().toISOString(),
          user: ctx.auth.userId ?? 'anonymous',
        },
      };
    },
  },
  {
    definition: accountSettingsPageDefinition,
    handler: async (ctx: RouteContext) => {
      const form = prepareFormState({
        session: ctx.session,
        formId: 'account-settings',
        route: updateAccountSettingsDefinition,
        now: ctx.now,
      });
      ctx.session = form.session;

      return {
        status: 200,
        body: renderAccountSettingsPage({
          csrfToken: form.csrfToken ?? '',
          issues: form.issues,
          values: form.values,
          flash: ctx.flash,
          currentEmail:
            getFormValue(form.values, 'email') ??
            getSessionProfileEmail(ctx.session) ??
            ctx.auth?.email ??
            'guest@example.com',
        }),
      };
    },
  },
  {
    definition: updateAccountSettingsDefinition,
    handler: async (ctx: RouteContext) => {
      const submission = processFormSubmission({
        session: ctx.session,
        body: ctx.body,
        auth: ctx.auth,
        formId: 'account-settings',
        route: updateAccountSettingsDefinition,
        redirectTo: accountSettingsPageDefinition.path,
        requireAuth: {
          redirectTo: accountSettingsPageDefinition.path,
          message: 'Sign-in required to update account settings.',
        },
        validate(values) {
          const email = getFormValue(values, 'email')?.trim() ?? '';
          const issues: FormIssue[] = [];
          if (email.length === 0) {
            issues.push({ field: 'email', message: 'Email is required.' });
          } else if (!email.includes('@')) {
            issues.push({ field: 'email', message: 'Enter a valid email address.' });
          }
          return issues;
        },
        now: ctx.now,
      });
      const nextSession = submission.session ?? {};
      ctx.session = nextSession;
      if (!submission.ok) {
        return submission.result;
      }

      nextSession.profile = {
        email: getFormValue(submission.values, 'email')?.trim() ?? 'guest@example.com',
      };

      return {
        status: 303,
        redirect: {
          location: accountSettingsPageDefinition.path,
        },
      };
    },
  },
];

const requestHooks: RequestHook[] = [
  {
    id: 'audit-hello',
    handler: async (ctx) => {
      ctx.db.lastHelloRequestId = ctx.requestId;
      ctx.logger.info('hello route request received', {
        requestId: ctx.requestId,
        session: ctx.session,
      });
      return undefined;
    },
  },
];

const jobs = [
  {
    name: 'nightly',
    schedule: '0 0 * * *',
    description: 'Example nightly maintenance job metadata surfaced in the manifest.',
  },
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/backend',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http', 'auth', 'db'],
    requestHooks: [
      {
        id: 'audit-hello',
        phase: 'beforeHandler',
        order: 10,
      },
    ],
    routes: routes.map((route) => route.definition),
    jobs,
  },
  routes,
  requestHooks,
};

function renderAccountSettingsPage(options: {
  csrfToken: string;
  issues: readonly FormIssue[];
  values: FormValues;
  flash: readonly {
    key: string;
    level: 'info' | 'success' | 'warning' | 'error';
    createdAt: string;
  }[];
  currentEmail: string;
}): string {
  const grouped = groupFormIssuesByField(options.issues);
  const email = escapeHtml(options.currentEmail);
  const inlineErrors = grouped.fields.email?.join(' ') ?? '';
  const flash = options.flash.map((message) => `${message.key}:${message.level}`).join(', ');
  const formErrors = grouped.form.join(' ');

  return [
    '<main>',
    '  <h1>Account Settings</h1>',
    `  <p data-flash="${escapeHtml(flash)}" data-form-errors="${escapeHtml(formErrors)}">Signed in as ${email}</p>`,
    '  <form method="post" action="/account/settings">',
    `    <input type="hidden" name="_csrf" value="${escapeHtml(options.csrfToken)}" />`,
    '    <label>',
    '      Email',
    `      <input name="email" type="email" value="${email}" />`,
    '    </label>',
    `    <p data-field="email">${escapeHtml(inlineErrors)}</p>`,
    '    <button type="submit">Save Settings</button>',
    '  </form>',
    '</main>',
  ].join('\n');
}

function getFormValue(values: FormValues, key: string): string | undefined {
  const raw = values[key];
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw) && typeof raw[0] === 'string') {
    return raw[0];
  }
  return undefined;
}

function getSessionProfileEmail(session: Record<string, unknown> | null): string | undefined {
  const profile = session?.profile;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return undefined;
  }
  return typeof (profile as { email?: unknown }).email === 'string'
    ? (profile as { email: string }).email
    : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
