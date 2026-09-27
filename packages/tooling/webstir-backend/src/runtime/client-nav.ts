import { CLIENT_NAV_HEADERS } from '@webstir-io/module-contract/client-nav';

const FOLLOWED = new Set([301, 302, 303]);
const METHOD_PRESERVING = new Set([307, 308]);

/**
 * A redirect for client-nav that can follow redirects itself becomes 204 with the destination in
 * `x-webstir-location`: a fetch that follows a 3xx cannot see its Location, so the destination
 * would lose its #fragment. 307 and 308 keep their method, so they only convert for GET and HEAD.
 */
export function toClientNavLocation(request: Request, response: Response): Response {
  if (request.headers.get(CLIENT_NAV_HEADERS.acceptLocation) !== '1') {
    return response;
  }
  const location = response.headers.get('location');
  const method = request.method.toUpperCase();
  const followable =
    FOLLOWED.has(response.status) ||
    (METHOD_PRESERVING.has(response.status) && (method === 'GET' || method === 'HEAD'));
  if (!location || !followable) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('location');
  headers.set(CLIENT_NAV_HEADERS.location, location);
  // Only client-nav's own request gets this answer, so no cache may hand it to a normal load.
  headers.set('cache-control', 'no-store');
  return new Response(null, { status: 204, headers });
}
