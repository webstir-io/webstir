import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { RouteHandlerResult } from '@webstir-io/webstir-backend/runtime/bun';

type Context = { request: Request; body: unknown; query: Record<string, string> };
type Note = { id: string; owner: string; title: string };
const store = path.join(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'), 'notes.json');
const sessions = new Map<string, { owner: string; csrf: string }>();
const credentials: Record<string, string> = { alice: 'alice-password', bob: 'bob-password' };
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const read = (): Note[] => existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : [];
function write(notes: Note[]) {
  mkdirSync(path.dirname(store), { recursive: true });
  writeFileSync(`${store}.tmp`, JSON.stringify(notes));
  renameSync(`${store}.tmp`, store);
}
function fields(body: unknown): Record<string, string> {
  return body && typeof body === 'object' ? body as Record<string, string> : {};
}
function session(request: Request) {
  const token = /(?:^|;\s*)notes_session=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  return token ? sessions.get(token) : undefined;
}
function html(body: string, status = 200): RouteHandlerResult {
  return { status, headers: { 'content-type': 'text/html; charset=utf-8' }, body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Team notes</title><link rel="stylesheet" href="/app/app.css"></head><body><main><h1>Team notes</h1>${body}<footer>Made for the Cedar team.</footer></main></body></html>` };
}
function redirect(): RouteHandlerResult { return { status: 303, redirect: { location: '/api/notes' } }; }
function form(action: string, content: string, csrf: string) {
  return `<form action="${action}" method="post"><input type="hidden" name="csrf" value="${csrf}">${content}</form>`;
}
function page(ctx: Context): RouteHandlerResult {
  const current = session(ctx.request);
  if (!current) return html(`<form action="/api/login" method="post"><label>Username<input name="username" autocomplete="username"></label><label>Password<input name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>`);
  const own = read().filter((note) => note.owner === current.owner);
  const cards = own.map((note) => `<article data-note-id="${note.id}"><h2>${escape(note.title)}</h2>${form('/api/notes/update', `<input type="hidden" name="id" value="${note.id}"><label>Title<input name="title" value="${escape(note.title)}" required></label><button>Save</button>`, current.csrf)}${form('/api/notes/delete', `<input type="hidden" name="id" value="${note.id}"><button>Delete</button>`, current.csrf)}</article>`).join('');
  return html(`<p>Signed in as ${current.owner}</p>${form('/api/logout', '<button>Sign out</button>', current.csrf)}${form('/api/notes/create', '<label>Title<input name="title" required></label><button>Create</button>', current.csrf)}${cards}`);
}
function login(ctx: Context): RouteHandlerResult {
  const values = fields(ctx.body);
  const expected = credentials[values.username ?? ''];
  const actual = values.password ?? '';
  if (!expected || Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return html('<p role="alert">Invalid credentials</p>', 401);
  const token = randomBytes(32).toString('hex');
  sessions.set(token, { owner: values.username!, csrf: randomBytes(24).toString('hex') });
  return { ...redirect(), headers: { 'set-cookie': `notes_session=${token}; HttpOnly; SameSite=Lax; Path=/` } };
}
function mutate(ctx: Context, operation: 'create' | 'update' | 'delete' | 'logout'): RouteHandlerResult {
  const current = session(ctx.request);
  if (!current) return html('<p role="alert">Sign in required</p>', 401);
  const values = fields(ctx.body);
  if (values.csrf !== current.csrf) return html('<p role="alert">Invalid form token</p>', 403);
  if (operation === 'logout') {
    const token = /(?:^|;\s*)notes_session=([^;]+)/.exec(ctx.request.headers.get('cookie') ?? '')?.[1];
    if (token) sessions.delete(token);
    return { ...redirect(), headers: { 'set-cookie': 'notes_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/' } };
  }
  const notes = read();
  const title = String(values.title ?? '').trim();
  if (operation !== 'delete' && !title) return html('<p role="alert">Title is required</p>', 422);
  if (operation === 'create') notes.push({ id: randomUUID(), owner: current.owner, title });
  else {
    const note = notes.find((entry) => entry.id === values.id && entry.owner === current.owner);
    if (!note) return html('<p role="alert">Note not found</p>', 404);
    if (operation === 'update') note.title = title;
    else notes.splice(notes.indexOf(note), 1);
  }
  write(notes);
  return redirect();
}
const routes = [
  { definition: { name: 'notes', method: 'GET', path: '/api/notes' }, handler: page },
  { definition: { name: 'login', method: 'POST', path: '/api/login', form: { contentType: 'application/x-www-form-urlencoded' } }, handler: login },
  ...(['create', 'update', 'delete', 'logout'] as const).map((operation) => ({
    definition: { name: operation, method: 'POST', path: operation === 'logout' ? '/api/logout' : `/api/notes/${operation}`, form: { contentType: 'application/x-www-form-urlencoded' } },
    handler: (ctx: Context) => mutate(ctx, operation),
  })),
];
export const module = {
  manifest: { contractVersion: '1.0.0', name: '@eval/team-notes', version: '1.0.0', kind: 'backend', capabilities: ['http'], routes: routes.map((route) => route.definition) },
  routes,
};
