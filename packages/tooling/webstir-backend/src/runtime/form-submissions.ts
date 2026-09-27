import {
  CLIENT_NAV_HEADERS,
  CLIENT_NAV_SUBMISSION_FIELD,
} from '@webstir-io/module-contract/client-nav';

import { readSessionMetadata } from './session-metadata.js';
import { getFormSessionRuntimeState } from './session-runtime.js';

const SUBMISSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const KEPT_SUBMISSIONS = 20;
// Redirects a browser follows with GET: only these end a submission. A 307 or 308 sends the same
// post, id included, on to its destination, which must still run.
const REPLAYABLE_REDIRECTS = new Set([301, 302, 303]);
// Long enough for a double click or a resent post, short enough that an old cookie soon stops
// leading anywhere; sooner still once the browser shows up with the new session.
const REISSUE_MS = 60_000;
const KEPT_REISSUES = 1_000;

export interface SubmissionAnswer {
  /** Where the first copy's action redirected. */
  readonly location: string;
  /** The session cookie its response set, when that moved the browser to another session. */
  readonly setCookie?: string;
}

const running = new Map<string, Promise<SubmissionAnswer | undefined>>();
// Answers that moved the browser to another session: signing in, a first session, signing out.
// A copy still carries the old cookie, so it cannot reach the answer recorded on the new session.
// Only a request signed with that old cookie finds one, and only for a short while.
const reissued = new Map<string, ReissuedAnswer>();
// The new session each answer handed out, so the answer goes once that session is in use.
const reissuedTo = new Map<string, string>();

interface ReissuedAnswer {
  readonly answer: SubmissionAnswer;
  readonly expiresAt: number;
  readonly sessionId?: string;
}

export interface SubmissionClaim {
  /** Where an earlier copy of this submission went; answer with that instead of running again. */
  readonly answered?: SubmissionAnswer;
  /** Records, on the session being committed, where the action redirected, if that ends it. */
  record(
    session: Record<string, unknown> | null,
    status: number,
    location: string | undefined,
    now: Date,
  ): void;
  /** Keeps the session cookie the recorded answer set, for copies that still carry the old one. */
  recordCookie(
    commit: { session: Record<string, unknown> | null; setCookie?: string },
    now: Date,
  ): void;
  /** Lets copies waiting on this one go on, with its answer if it recorded one. */
  release(): void;
}

/**
 * Starts a submission, or finds its answer: one that moved the browser to another session, one
 * recorded in the session, or, for a copy that arrives while the first is still running, the
 * answer the first records. `sessionId` is the id the request's signed cookie names, so only the
 * browser that sent the first copy is answered, even once that session has ended.
 */
export async function claimSubmission(
  sessionId: string,
  session: Record<string, unknown> | null,
  id: string,
  now: Date,
): Promise<SubmissionClaim> {
  const key = `${sessionId}\0${id}`;
  const first = running.get(key);
  const answered =
    (first ? await first : undefined) ??
    findReissued(key, now) ??
    (session ? findSubmission(session, id) : undefined);
  if (answered) {
    return { answered, record() {}, recordCookie() {}, release() {} };
  }
  let recorded: SubmissionAnswer | undefined;
  let settle: (answer: SubmissionAnswer | undefined) => void = () => {};
  const done = new Promise<SubmissionAnswer | undefined>((resolve) => {
    settle = resolve;
  });
  running.set(key, done);
  return {
    record(committed, status, location, now) {
      if (!location || !REPLAYABLE_REDIRECTS.has(status)) return;
      // Copies already waiting get the answer even when the action ended the session.
      recorded = { location };
      if (committed) recordSubmission(committed, id, location, now);
    },
    recordCookie({ session: committed, setCookie }, now) {
      if (!recorded || !setCookie) return;
      recorded = { ...recorded, setCookie };
      keepReissued(key, recorded, readSessionMetadata(committed)?.id, now);
    },
    release() {
      if (running.get(key) === done) running.delete(key);
      settle(recorded);
    },
  };
}

/**
 * The id client-nav gave this form submission: a header on its own fetch, or a form field when it
 * fell back to a normal post. The field is taken out of the body, so actions never see it.
 */
export function takeSubmissionId(request: Request, body: unknown): string | undefined {
  let id = request.headers.get(CLIENT_NAV_HEADERS.submission) ?? undefined;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const field = record[CLIENT_NAV_SUBMISSION_FIELD];
    if (field !== undefined) {
      delete record[CLIENT_NAV_SUBMISSION_FIELD];
      id ??= typeof field === 'string' ? field : undefined;
    }
  }
  return id && SUBMISSION_ID.test(id) ? id : undefined;
}

/** Where the first post of this submission went, if it already went somewhere. */
function findSubmission(
  session: Record<string, unknown>,
  id: string,
): SubmissionAnswer | undefined {
  const location = getFormSessionRuntimeState(session).submissions?.[id]?.location;
  return location ? { location } : undefined;
}

function findReissued(key: string, now: Date): SubmissionAnswer | undefined {
  forgetExpired(now);
  const entry = reissued.get(key);
  return entry && entry.expiresAt > now.getTime() ? entry.answer : undefined;
}

function keepReissued(
  key: string,
  answer: SubmissionAnswer,
  sessionId: string | undefined,
  now: Date,
): void {
  forgetExpired(now);
  forgetReissued(key);
  reissued.set(key, { answer, expiresAt: now.getTime() + REISSUE_MS, sessionId });
  if (sessionId) reissuedTo.set(sessionId, key);
  if (reissued.size > KEPT_REISSUES) {
    forgetReissued(reissued.keys().next().value as string);
  }
}

/**
 * A request carrying a session an answer handed out shows the browser has its cookie, so every
 * later copy it sends carries that session too, and the old cookie need not lead there any more.
 */
export function forgetReissuedTo(sessionId: string): void {
  const key = reissuedTo.get(sessionId);
  if (key) forgetReissued(key);
}

function forgetReissued(key: string): void {
  const entry = reissued.get(key);
  if (!entry) return;
  reissued.delete(key);
  if (entry.sessionId) reissuedTo.delete(entry.sessionId);
}

/** Entries are kept in the order they were made, so the expired ones come first. */
function forgetExpired(now: Date): void {
  for (const [key, entry] of reissued) {
    if (entry.expiresAt > now.getTime()) return;
    forgetReissued(key);
  }
}

/** Remembers where a submission's action redirected, keeping only the most recent few. */
function recordSubmission(
  session: Record<string, unknown>,
  id: string,
  location: string,
  now: Date,
): void {
  const store = getFormSessionRuntimeState(session);
  const submissions = {
    ...(store.submissions ?? {}),
    [id]: { location, createdAt: now.toISOString() },
  };
  const newest = Object.entries(submissions)
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, KEPT_SUBMISSIONS);
  store.submissions = Object.fromEntries(newest);
}
