import { randomUUID } from 'node:crypto';
import type { Database } from '@webstir-io/webstir-backend/db';
import type { RouteHandlerResult } from '@webstir-io/webstir-backend/runtime/bun';
import {
  prepareFormState,
  processFormSubmission,
  type FormValues,
} from '@webstir-io/webstir-backend/runtime/forms';

// Who is signed in: ctx.user with Webstir's sign-in, or the principal an app's own
// resolveRequestAuth verifies, mapped to { userId }.
interface Context {
  db: Database;
  user?: { id: string } | null;
  auth?: { userId: string };
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  session: Record<string, unknown> | null;
}

interface Project {
  id: string;
  title: string;
  status: 'active' | 'archived';
}

const BASE = '/api/projects';
const STATUSES = ['active', 'archived'] as const;

// The projects table and its status column come from the app's migrations (see README.md).
export function createProjectRoutes() {
  async function render(context: Context, status = 200): Promise<RouteHandlerResult> {
    const owner = ownerOf(context)!;
    const filter = context.query.status ?? '';
    if (filter && !isStatus(filter)) return page('Unknown status filter.', 400);
    const projects = filter
      ? await context.db.query<Project>('SELECT id, title, status FROM projects WHERE owner_id = ? AND status = ? ORDER BY title', [owner, filter])
      : await context.db.query<Project>('SELECT id, title, status FROM projects WHERE owner_id = ? ORDER BY title', [owner]);
    const cards = projects.map((project) => `<article data-project-id="${escapeHtml(project.id)}">
      <h2>${escapeHtml(project.title)}</h2>${editForm(context, project)}
      ${deleteForm(context, project)}</article>`).join('');
    return page(`<form method="get" action="${BASE}">
      <label>Status <select name="status"><option value="">All</option>${options(filter)}</select></label>
      <button type="submit">Filter</button></form>
      ${editForm(context)}${cards || '<p>No projects match this filter.</p>'}`, status);
  }

  function editForm(context: Context, project?: Project): string {
    const formId = project ? `edit:${project.id}` : 'create';
    const state = prepareFormState({ session: context.session, formId, csrf: true });
    context.session = state.session;
    const title = text(state.values, 'title', project?.title ?? '');
    const status = text(state.values, 'status', project?.status ?? 'active');
    const errors = state.issues.map((issue) => `<li>${escapeHtml(issue.message)}</li>`).join('');
    return `<form method="post" action="${project ? `${BASE}/${encodeURIComponent(project.id)}` : BASE}">
      ${errors ? `<ul role="alert">${errors}</ul>` : ''}
      <input type="hidden" name="_csrf" value="${escapeHtml(state.csrfToken!)}">
      <label>Title <input name="title" required maxlength="120" value="${escapeHtml(title)}"></label>
      <label>Status <select name="status">${options(status)}</select></label>
      <button type="submit">${project ? 'Save project' : 'Create project'}</button></form>`;
  }

  function deleteForm(context: Context, project: Project): string {
    const state = prepareFormState({ session: context.session, formId: `delete:${project.id}`, csrf: true });
    context.session = state.session;
    return `<form method="post" action="${BASE}/${encodeURIComponent(project.id)}/delete">
      <input type="hidden" name="_csrf" value="${escapeHtml(state.csrfToken!)}">
      <button type="submit">Delete ${escapeHtml(project.title)}</button></form>`;
  }

  async function save(context: Context, existing?: Project): Promise<RouteHandlerResult> {
    const formId = existing ? `edit:${existing.id}` : 'create';
    const submitted = processFormSubmission({
      session: context.session, body: context.body, formId, csrf: true,
      validate: (values) => [
        ...(!text(values, 'title').trim() || text(values, 'title').trim().length > 120
          ? [{ field: 'title', message: 'Title must contain 1–120 characters.' }] : []),
        ...(!isStatus(text(values, 'status')) ? [{ field: 'status', message: 'Choose active or archived.' }] : []),
      ],
    });
    context.session = submitted.session;
    if (!submitted.ok) return render(context, submitted.result.status);
    const title = text(submitted.values, 'title').trim();
    const status = text(submitted.values, 'status');
    if (existing) {
      const result = await context.db.execute('UPDATE projects SET title = ?, status = ? WHERE id = ? AND owner_id = ?',
        [title, status, existing.id, ownerOf(context)]);
      if (!result.changes) return page('Project not found.', 404);
    } else {
      await context.db.execute('INSERT INTO projects (id, owner_id, title, status) VALUES (?, ?, ?, ?)',
        [randomUUID(), ownerOf(context), title, status]);
    }
    return { status: 303, redirect: { location: BASE } };
  }

  function owned(context: Context): Promise<Project | undefined> {
    return context.db.get<Project>('SELECT id, title, status FROM projects WHERE id = ? AND owner_id = ?',
      [context.params.id, ownerOf(context)]);
  }

  return [
    route('projectsList', 'GET', BASE, (context) => render(context)),
    route('projectsCreate', 'POST', BASE, (context) => save(context)),
    route('projectsUpdate', 'POST', `${BASE}/:id`, async (context) => {
      const project = await owned(context);
      return project ? save(context, project) : page('Project not found.', 404);
    }),
    route('projectsDelete', 'POST', `${BASE}/:id/delete`, async (context) => {
      const project = await owned(context);
      if (!project) return page('Project not found.', 404);
      const submitted = processFormSubmission({
        session: context.session, body: context.body, formId: `delete:${project.id}`, csrf: true,
      });
      context.session = submitted.session;
      if (!submitted.ok) return page('Form session expired. Reload the projects page.', 403);
      await context.db.execute('DELETE FROM projects WHERE id = ? AND owner_id = ?', [project.id, ownerOf(context)]);
      return { status: 303, redirect: { location: BASE } };
    }),
  ];
}

function route(
  name: string,
  method: 'GET' | 'POST',
  path: string,
  handler: (context: Context) => Promise<RouteHandlerResult>,
) {
  return {
    definition: {
      name, method, path,
      session: { mode: 'optional' as const, write: true },
      ...(method === 'POST' ? { form: { contentType: 'application/x-www-form-urlencoded' as const, csrf: true } } : {}),
    },
    handler: async (context: Context): Promise<RouteHandlerResult> => {
      if (!ownerOf(context)) return page('Sign in required.', 401);
      return handler(context);
    },
  };
}

/** The signed-in owner, never a form field or a caller-supplied header. */
function ownerOf(context: Context): string | undefined {
  return context.user?.id ?? context.auth?.userId;
}

function options(selected: string): string {
  return STATUSES.map((status) => `<option value="${status}"${status === selected ? ' selected' : ''}>${status}</option>`).join('');
}

function isStatus(value: string): value is Project['status'] {
  return value === 'active' || value === 'archived';
}

function text(values: FormValues, key: string, fallback = ''): string {
  return typeof values[key] === 'string' ? values[key] : fallback;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function page(body: string, status = 200): RouteHandlerResult {
  return { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>Projects</title></head>
    <body><main><h1>Projects</h1>${body}<p><a href="${BASE}">All projects</a></p></main></body></html>` };
}
