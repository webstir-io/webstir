/**
 * The wire protocol between the client-nav feature and the backend runtime. Constants only, so a
 * browser bundle can import them without the rest of the contract.
 */
export const CLIENT_NAV_HEADERS = {
  /** Sent on every request client-nav makes itself. */
  request: 'x-webstir-client-nav',
  /**
   * Sent when client-nav can follow a redirect itself: the backend then answers a redirect with
   * 204 and `location` instead of 3xx, so the destination keeps its #fragment.
   */
  acceptLocation: 'x-webstir-accept-location',
  /** Where to go next, in place of a redirect's Location. */
  location: 'x-webstir-location',
  /** Identifies one form submission, so the same post sent again gets the first answer. */
  submission: 'x-webstir-submission',
} as const;

/**
 * The form field carrying a submission id: rendered into every POST form a view renders, and set by
 * client-nav when it falls back to a normal post.
 */
export const CLIENT_NAV_SUBMISSION_FIELD = '_webstir_submission';
