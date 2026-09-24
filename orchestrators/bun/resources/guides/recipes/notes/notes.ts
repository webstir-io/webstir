import { randomUUID } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { RouteHandlerResult } from '@webstir-io/webstir-backend/runtime/bun';
import {
  prepareFormState,
  processFormSubmission,
  type FormValues,
} from '@webstir-io/webstir-backend/runtime/forms';

interface Context {
  params: Record<string, string>;
  body: unknown;
  session: Record<string, unknown> | null;
}

interface Note {
  id: string;
  title: string;
  body: string;
}

const BASE = '/api/notes';
const htmlHeaders = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };

// Defer opening storage until a request; build/inspect import the route module.
export function createNotesRoutes(getDatabase: () => Database) {
  let connection: Database | undefined;
  function database(): Database {
    if (connection) return connection;
    const db = getDatabase();
    db.exec(`CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      body TEXT NOT NULL CHECK(length(body) <= 10000)
    )`);
    connection = db;
    return db;
  }

  function read(id: string): Note | null {
    return database().query<Note, [string]>('SELECT id, title, body FROM notes WHERE id = ?').get(id);
  }

  function form(context: Context, id: string, note?: Note, errorStatus = 200): RouteHandlerResult {
    const state = prepareFormState({ session: context.session, formId: id, csrf: true });
    context.session = state.session;
    const title = text(state.values, 'title', note?.title ?? '');
    const body = text(state.values, 'body', note?.body ?? '');
    const action = note ? `${BASE}/${encodeURIComponent(note.id)}` : BASE;
    const issues = state.issues.map((issue) => `<li>${escapeHtml(issue.message)}</li>`).join('');
    const fields = `<form method="post" action="${action}">
      <input type="hidden" name="_csrf" value="${escapeHtml(state.csrfToken!)}">
      <label>Title <input name="title" required maxlength="120" value="${escapeHtml(title)}"></label>
      <label>Body <textarea name="body" maxlength="10000">${escapeHtml(body)}</textarea></label>
      <button type="submit">${note ? 'Save note' : 'Create note'}</button>
    </form>`;
    const notes = note ? '' : database().query<Note, []>('SELECT id, title, body FROM notes ORDER BY rowid DESC').all()
      .map((item) => `<article data-note-id="${escapeHtml(item.id)}">
        <h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.body)}</p>
        <a href="${BASE}/${encodeURIComponent(item.id)}/edit">Edit ${escapeHtml(item.title)}</a>
      </article>`).join('');
    let deleteForm = '';
    if (note) {
      const deletion = prepareFormState({ session: context.session, formId: `delete:${note.id}`, csrf: true });
      context.session = deletion.session;
      deleteForm = `<form method="post" action="${BASE}/${encodeURIComponent(note.id)}/delete">
        <input type="hidden" name="_csrf" value="${escapeHtml(deletion.csrfToken!)}">
        <button type="submit">Delete note</button>
      </form>`;
    }
    return page(note ? 'Edit note' : 'Notes', `${issues ? `<ul role="alert">${issues}</ul>` : ''}
      ${fields}${deleteForm}${notes}<p><a href="${BASE}">All notes</a></p>`, errorStatus);
  }

  function save(context: Context, note?: Note): RouteHandlerResult {
    const formId = note ? `edit:${note.id}` : 'create';
    const submitted = processFormSubmission({
      session: context.session,
      body: context.body,
      formId,
      csrf: true,
      validate: (values) => {
        const title = text(values, 'title').trim();
        const body = text(values, 'body');
        return [
          ...(!title || title.length > 120 ? [{ field: 'title', message: 'Title must contain 1–120 characters.' }] : []),
          ...(body.length > 10000 ? [{ field: 'body', message: 'Body must contain at most 10,000 characters.' }] : []),
        ];
      },
    });
    context.session = submitted.session;
    if (!submitted.ok) {
      return form(context, formId, note, submitted.result.status);
    }
    const title = text(submitted.values, 'title').trim();
    const body = text(submitted.values, 'body');
    if (note) {
      database().query('UPDATE notes SET title = ?, body = ? WHERE id = ?').run(title, body, note.id);
    } else {
      database().query('INSERT INTO notes (id, title, body) VALUES (?, ?, ?)').run(randomUUID(), title, body);
    }
    return { status: 303, redirect: { location: BASE } };
  }

  return [
    route('notesList', 'GET', BASE, (context) => form(context, 'create')),
    route('notesCreate', 'POST', BASE, (context) => save(context)),
    route('notesEdit', 'GET', `${BASE}/:id/edit`, (context) => {
      const note = read(context.params.id);
      return note ? form(context, `edit:${note.id}`, note) : page('Not found', 'Note not found.', 404);
    }),
    route('notesUpdate', 'POST', `${BASE}/:id`, (context) => {
      const note = read(context.params.id);
      return note ? save(context, note) : page('Not found', 'Note not found.', 404);
    }),
    route('notesDelete', 'POST', `${BASE}/:id/delete`, (context) => {
      const note = read(context.params.id);
      if (!note) return page('Not found', 'Note not found.', 404);
      const submitted = processFormSubmission({
        session: context.session, body: context.body, formId: `delete:${note.id}`, csrf: true,
      });
      context.session = submitted.session;
      if (!submitted.ok) {
        return page('Delete blocked', `Form session expired. <a href="${BASE}/${encodeURIComponent(note.id)}/edit">Return to the note</a> and try again.`, 403);
      }
      database().query('DELETE FROM notes WHERE id = ?').run(note.id);
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
    handler,
  };
}

function text(values: FormValues, key: string, fallback = ''): string {
  return typeof values[key] === 'string' ? values[key] : fallback;
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function page(title: string, body: string, status = 200): RouteHandlerResult {
  return { status, headers: htmlHeaders, body: `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>` };
}
