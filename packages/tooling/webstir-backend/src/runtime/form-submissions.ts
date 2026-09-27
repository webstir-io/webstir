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
const running = new Map<string, Promise<string | undefined>>();

export interface SubmissionClaim {
  /** Where an earlier copy of this submission went; answer with that instead of running again. */
  readonly answered?: string;
  /** Records, on the session being committed, where the action redirected, if that ends it. */
  record(
    session: Record<string, unknown> | null,
    status: number,
    location: string | undefined,
    now: Date,
  ): void;
  /** Lets copies waiting on this one go on, with its answer if it recorded one. */
  release(): void;
}

/**
 * Starts a submission, or finds its answer: one already recorded in the session, or, for a copy
 * that arrives while the first is still running, the answer the first records.
 */
export async function claimSubmission(
  session: Record<string, unknown>,
  id: string,
): Promise<SubmissionClaim> {
  const key = `${readSessionMetadata(session)?.id ?? ''}\0${id}`;
  const first = running.get(key);
  const answered = (first ? await first : undefined) ?? findSubmission(session, id);
  if (answered) {
    return { answered, record() {}, release() {} };
  }
  let recorded: string | undefined;
  let settle: (location: string | undefined) => void = () => {};
  const done = new Promise<string | undefined>((resolve) => {
    settle = resolve;
  });
  running.set(key, done);
  return {
    record(committed, status, location, now) {
      if (committed && location && REPLAYABLE_REDIRECTS.has(status)) {
        recordSubmission(committed, id, location, now);
        recorded = location;
      }
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
function findSubmission(session: Record<string, unknown>, id: string): string | undefined {
  return getFormSessionRuntimeState(session).submissions?.[id]?.location;
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
