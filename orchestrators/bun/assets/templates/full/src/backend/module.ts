import { z } from 'zod';
import { processFormSubmission } from '@webstir-io/webstir-backend/runtime/forms';

interface GreetContext {
  readonly body: unknown;
  session: Record<string, unknown> | null;
}

// The home page (src/frontend/pages/home) rendered on each request, with the messages a form
// left for it.
const home = {
  definition: { name: 'home', path: '/', page: 'home' },
  // What the page binds besides the messages every view has; add fields as the page grows, and
  // load them here from the request, the session or the database.
  data: z.object({}),
  load: () => ({}),
};

// The home page's form. It works as a plain HTML form: the server answers the post with a
// redirect back, carrying a message for the next page.
const greet = {
  definition: {
    name: 'greet',
    method: 'POST' as const,
    path: '/greet',
    interaction: 'navigation' as const,
    session: { mode: 'optional' as const, write: true },
    form: { contentType: 'application/x-www-form-urlencoded' as const, csrf: true },
  },
  handler(ctx: GreetContext) {
    const submitted = processFormSubmission({
      session: ctx.session,
      body: ctx.body,
      formId: 'greet',
      csrf: true,
      redirectTo: '/',
    });
    ctx.session = submitted.session;
    if (!submitted.ok) return submitted.result;
    const name = String(submitted.values.name ?? '').trim() || 'there';
    return {
      status: 303,
      redirect: { location: '/' },
      flash: [{ level: 'success' as const, message: `Hello, ${name}!` }],
    };
  },
};

const routes = [greet];
const views = [home];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: 'app',
    version: '1.0.0',
    kind: 'backend',
    capabilities: ['http', 'views'],
    routes: routes.map((route) => route.definition),
    views: views.map((view) => view.definition),
  },
  routes,
  views,
};
