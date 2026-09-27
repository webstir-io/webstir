import {
  CLIENT_NAV_HEADERS,
  CLIENT_NAV_SUBMISSION_FIELD,
} from '@webstir-io/module-contract/client-nav';

import { getFormSessionRuntimeState } from './session-runtime.js';

const SUBMISSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const KEPT_SUBMISSIONS = 20;

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
export function findSubmission(session: Record<string, unknown>, id: string): string | undefined {
  return getFormSessionRuntimeState(session).submissions?.[id]?.location;
}

/** Remembers where a submission's action redirected, keeping only the most recent few. */
export function recordSubmission(
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
