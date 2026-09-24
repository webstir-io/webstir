import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { RouteHandlerResult } from '@webstir-io/webstir-backend/runtime/bun';
import {
  prepareFormState,
  processFormSubmission,
  type FormValues,
} from '@webstir-io/webstir-backend/runtime/forms';

// Map the existing, verified auth principal to this shape in resolveRequestAuth.
interface Context {
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

export function createProjectRoutes(getDatabase: () => Database) {
  let connection: Database | undefined;
  function database(): Database {
    if (connection) return connection;
    const db = getDatabase();
    // Initialize only inside authenticated handlers, never during module inspection.
    db.exec(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL
    )`);
    const columns = db.query<{ name: string }, []>('PRAGMA table_info(projects)').all();
    if (!columns.some((column) => column.name === 'status')) {
      db.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived'))");
    }
    db.exec('CREATE INDEX IF NOT EXISTS projects_owner_status ON projects(owner_id, status)');
    connection = db;
    return db;
  }

  function render(context: Context, status = 200): RouteHandlerResult {
    const owner = context.auth!.userId;
    const filter = context.query.status ?? '';
    if (filter && !isStatus(filter)) return page('Unknown status filter.', 400);
    const projects = filter
      ? database().query<Project, [string, string]>('SELECT id, title, status FROM projects WHERE owner_id = ? AND status = ? ORDER BY rowid DESC').all(owner, filter)
      : database().query<Project, [string]>('SELECT id, title, status FROM projects WHERE owner_id = ? ORDER BY rowid DESC').all(owner);
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

  function save(context: Context, existing?: Project): RouteHandlerResult {
    const formId = existing ? `edit:${existing.id}` : 'create';
    const submitted = processFormSubmission({
      session: context.session, body: context.body, auth: context.auth, requireAuth: true, formId, csrf: true,
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
      const result = database().query('UPDATE projects SET title = ?, status = ? WHERE id = ? AND owner_id = ?')
        .run(title, status, existing.id, context.auth!.userId);
      if (!result.changes) return page('Project not found.', 404);
    } else {
      database().query('INSERT INTO projects (id, owner_id, title, status) VALUES (?, ?, ?, ?)')
        .run(randomUUID(), context.auth!.userId, title, status);
    }
    return { status: 303, redirect: { location: BASE } };
  }

  function owned(context: Context): Project | null {
    return database().query<Project, [string, string]>('SELECT id, title, status FROM projects WHERE id = ? AND owner_id = ?')
      .get(context.params.id, context.auth!.userId);
  }

  return [
    route('projectsList', 'GET', BASE, (context) => render(context)),
    route('projectsCreate', 'POST', BASE, (context) => save(context)),
    route('projectsUpdate', 'POST', `${BASE}/:id`, (context) => {
      const project = owned(context);
      return project ? save(context, project) : page('Project not found.', 404);
    }),
    route('projectsDelete', 'POST', `${BASE}/:id/delete`, (context) => {
      const project = owned(context);
      if (!project) return page('Project not found.', 404);
      const submitted = processFormSubmission({
        session: context.session, body: context.body, auth: context.auth, requireAuth: true,
        formId: `delete:${project.id}`, csrf: true,
      });
      context.session = submitted.session;
      if (!submitted.ok) return page('Form session expired. Reload the projects page.', 403);
      database().query('DELETE FROM projects WHERE id = ? AND owner_id = ?').run(project.id, context.auth!.userId);
      return { status: 303, redirect: { location: BASE } };
    }),
  ];
}

function route(name: string, method: 'GET' | 'POST', path: string, handler: (context: Context) => RouteHandlerResult) {
  return {
    definition: {
      name, method, path,
      session: { mode: 'optional' as const, write: true },
      ...(method === 'POST' ? { form: { contentType: 'application/x-www-form-urlencoded' as const, csrf: true } } : {}),
    },
    handler: (context: Context): RouteHandlerResult => {
      if (!context.auth?.userId) return page('Sign in required.', 401);
      return handler(context);
    },
  };
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
