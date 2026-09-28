import { randomUUID } from 'node:crypto';

import { z } from 'zod';
import type { Database } from '@webstir-io/webstir-backend/db';
import type { Jobs } from '@webstir-io/webstir-backend/jobs';
import { processFormSubmission, type FormValues } from '@webstir-io/webstir-backend/runtime/forms';

const STATUSES = ['draft', 'active', 'archived'] as const;
type Status = (typeof STATUSES)[number];

interface User {
  readonly id: string;
  readonly email: string;
}

interface ViewContext {
  readonly user: User;
  readonly db: Database;
  readonly forms: { read(formId: string): { values: FormValues; errors: Record<string, string> } };
}

interface ActionContext {
  readonly user: User;
  readonly db: Database;
  readonly jobs: Jobs;
  readonly body: unknown;
  readonly params: Record<string, string>;
  session: Record<string, unknown> | null;
}

interface ProjectRow {
  id: string;
  title: string;
  status: Status;
  notes: string;
}

const projectsData = z.object({
  email: z.string(),
  empty: z.boolean(),
  create: z.object({ title: z.string(), notes: z.string(), error: z.string() }),
  projects: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      notes: z.string(),
      draft: z.boolean(),
      active: z.boolean(),
      archived: z.boolean(),
      editForm: z.string(),
      deleteForm: z.string(),
      updateAction: z.string(),
      deleteAction: z.string(),
    }),
  ),
});

const projectsView = {
  definition: { name: 'projects', path: '/projects', page: 'projects', auth: 'required' as const },
  data: projectsData,
  async load(ctx: ViewContext): Promise<z.infer<typeof projectsData>> {
    const rows = await ctx.db.query<ProjectRow>(
      'SELECT id, title, status, notes FROM projects WHERE owner_id = ? ORDER BY created_at DESC',
      [ctx.user.id],
    );
    const create = ctx.forms.read('project-create');
    return {
      email: ctx.user.email,
      empty: rows.length === 0,
      create: {
        title: String(create.values.title ?? ''),
        notes: String(create.values.notes ?? ''),
        error: create.errors.title ?? create.errors.form ?? '',
      },
      projects: rows.map((row) => ({
        id: row.id,
        title: row.title,
        notes: row.notes,
        draft: row.status === 'draft',
        active: row.status === 'active',
        archived: row.status === 'archived',
        editForm: `project-edit-form-${row.id}`,
        deleteForm: `project-delete-form-${row.id}`,
        updateAction: `/projects/${row.id}`,
        deleteAction: `/projects/${row.id}/delete`,
      })),
    };
  },
};

const formRoute = (name: string, path: string) => ({
  name,
  method: 'POST' as const,
  path,
  interaction: 'navigation' as const,
  auth: 'required' as const,
  session: { mode: 'optional' as const, write: true },
  form: { contentType: 'application/x-www-form-urlencoded' as const, csrf: true },
});

/** The submitted project, or the issue that sends the form back. */
function readProject(values: FormValues) {
  const title = String(values.title ?? '').trim();
  const status = STATUSES.includes(values.status as Status) ? (values.status as Status) : 'draft';
  return { title, status, notes: String(values.notes ?? '').trim() };
}

function submit(ctx: ActionContext, formId: string) {
  const submitted = processFormSubmission({
    session: ctx.session,
    body: ctx.body,
    formId,
    csrf: true,
    redirectTo: '/projects/',
  });
  ctx.session = submitted.session;
  return submitted;
}

const createProject = {
  definition: formRoute('createProject', '/projects'),
  async handler(ctx: ActionContext) {
    const submitted = submit(ctx, 'project-create');
    if (!submitted.ok) return submitted.result;
    const project = readProject(submitted.values);
    if (!project.title) {
      return {
        status: 422,
        rerender: {
          view: 'projects',
          form: {
            id: 'project-create',
            values: submitted.values,
            issues: [{ code: 'validation' as const, field: 'title', message: 'Project title is required.' }],
          },
        },
      };
    }
    await ctx.db.execute(
      'INSERT INTO projects (id, owner_id, title, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [randomUUID(), ctx.user.id, project.title, project.status, project.notes, new Date()],
    );
    await ctx.jobs.enqueue('project-created', { to: ctx.user.email, title: project.title });
    return {
      status: 303,
      redirect: { location: '/projects/' },
      flash: [{ level: 'success' as const, message: `Created project "${project.title}".` }],
    };
  },
};

const updateProject = {
  definition: formRoute('updateProject', '/projects/:id'),
  async handler(ctx: ActionContext) {
    const submitted = submit(ctx, 'project-edit');
    if (!submitted.ok) return submitted.result;
    const project = readProject(submitted.values);
    if (!project.title) {
      return {
        status: 303,
        redirect: { location: '/projects/' },
        flash: [{ level: 'error' as const, message: 'Project title is required.' }],
      };
    }
    await ctx.db.execute(
      'UPDATE projects SET title = ?, status = ?, notes = ? WHERE id = ? AND owner_id = ?',
      [project.title, project.status, project.notes, ctx.params.id, ctx.user.id],
    );
    return {
      status: 303,
      redirect: { location: '/projects/' },
      flash: [{ level: 'success' as const, message: `Updated project "${project.title}".` }],
    };
  },
};

const deleteProject = {
  definition: formRoute('deleteProject', '/projects/:id/delete'),
  async handler(ctx: ActionContext) {
    const submitted = submit(ctx, 'project-delete');
    if (!submitted.ok) return submitted.result;
    const project = await ctx.db.get<{ title: string }>(
      'SELECT title FROM projects WHERE id = ? AND owner_id = ?',
      [ctx.params.id, ctx.user.id],
    );
    await ctx.db.execute('DELETE FROM projects WHERE id = ? AND owner_id = ?', [
      ctx.params.id,
      ctx.user.id,
    ]);
    return {
      status: 303,
      redirect: { location: '/projects/' },
      flash: project
        ? [{ level: 'success' as const, message: `Deleted project "${project.title}".` }]
        : [],
    };
  },
};

const rootStatus = {
  definition: { name: 'rootStatus', method: 'GET' as const, path: '/api' },
  handler: () => ({
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'API server running',
  }),
};

const routes = [rootStatus, createProject, updateProject, deleteProject];
const views = [projectsView];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/auth-crud',
    version: '1.0.0',
    kind: 'backend',
    capabilities: ['http', 'views'],
    routes: routes.map((route) => route.definition),
    views: views.map((view) => view.definition),
  },
  routes,
  views,
};
