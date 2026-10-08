import * as oauth from 'oauth4webapi';

import type { SignInIdentity, SignInProvider } from './providers.js';

/** What an app says about an OpenID Connect provider, such as Microsoft Entra, Google or Okta. */
export interface OidcOptions {
  /** In the addresses: `/sign-in/<id>/` and `/sign-in/<id>/callback/`. */
  readonly id: string;
  /** On the sign-in page: "Sign in with <label>". */
  readonly label: string;
  /** The provider's issuer address; its `/.well-known/openid-configuration` says the rest. */
  readonly issuer: string | undefined;
  readonly clientId: string | undefined;
  readonly clientSecret: string | undefined;
  /** What to ask for. `openid` is always asked for; `email` and `profile` by default. */
  readonly scopes?: readonly string[];
  /**
   * More to send to the provider's sign-in page, such as `{ prompt: 'select_account' }`. Not the
   * parameters the flow itself sets or depends on; with `max_age`, the token's `auth_time` is
   * checked against it.
   */
  readonly authorizeParams?: Readonly<Record<string, string>>;
  /** Whether a first sign-in may create the user. True by default. */
  readonly allowSignUp?: boolean;
  /**
   * Who the ID token's claims say signed in. By default `sub`, and `email` only when the provider
   * says it is verified. An `email` passed on from here decides which user a person becomes, so
   * pass one only when the provider vouches for it.
   */
  identity?(claims: Readonly<Record<string, unknown>>): SignInIdentity;
}

const TIMEOUT_MS = 5_000;
const DISCOVERY_MS = 60 * 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 30;
// Set by the flow, or changing how the answer comes back or what was asked for behind its back.
const FLOW_PARAMETERS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'response_mode',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
  'request',
  'request_uri',
];

/**
 * Sign-in through an OpenID Connect provider: the authorization code flow with PKCE, a state
 * and a nonce. The ID token is checked for its issuer, audience, nonce, lifetime and signature.
 */
export function oidc(options: OidcOptions): SignInProvider {
  const taken = Object.keys(options.authorizeParams ?? {}).filter((name) =>
    FLOW_PARAMETERS.includes(name),
  );
  if (taken.length > 0) {
    throw new Error(
      `[sign-in] oidc({ id: '${options.id}' }): authorizeParams cannot set ${taken.join(', ')}; the flow sets or depends on ${taken.length > 1 ? 'them' : 'it'}.`,
    );
  }
  const maxAge = options.authorizeParams?.max_age;
  if (maxAge !== undefined && !/^\d+$/.test(maxAge)) {
    throw new Error(
      `[sign-in] oidc({ id: '${options.id}' }): authorizeParams.max_age must be a number of seconds.`,
    );
  }
  const missing = (): string | undefined => {
    for (const name of ['issuer', 'clientId', 'clientSecret'] as const) {
      if (!options[name]?.trim()) return `it has no ${name}.`;
    }
    return undefined;
  };
  const http = () => ({
    signal: () => AbortSignal.timeout(TIMEOUT_MS),
    // A provider on this machine, in development and tests, is reached without TLS.
    ...(isLoopbackHttp(options.issuer) ? { [oauth.allowInsecureRequests]: true } : {}),
  });

  let known: { at: number; server: Promise<oauth.AuthorizationServer> } | undefined;
  const server = (): Promise<oauth.AuthorizationServer> => {
    if (!known || Date.now() - known.at > DISCOVERY_MS) {
      const issuer = new URL(String(options.issuer));
      const found = oauth
        .discoveryRequest(issuer, http())
        .then((response) => oauth.processDiscoveryResponse(issuer, response));
      known = { at: Date.now(), server: found };
      // A failed lookup is tried again by the next visitor.
      found.catch(() => {
        if (known?.server === found) known = undefined;
      });
    }
    return known.server;
  };
  const client = (): oauth.Client => ({
    client_id: String(options.clientId),
    [oauth.clockTolerance]: CLOCK_TOLERANCE_SECONDS,
  });
  const ready = (): void => {
    const problem = missing();
    if (problem) throw new Error(problem);
  };

  return {
    id: options.id,
    label: options.label,
    ...(options.allowSignUp === undefined ? {} : { allowSignUp: options.allowSignUp }),
    setupProblem() {
      const problem = missing();
      if (problem) return problem;
      return String(options.issuer).startsWith('https://')
        ? undefined
        : 'its issuer must be an https address.';
    },
    async start({ redirectUri }) {
      ready();
      const as = await server();
      if (!as.authorization_endpoint) throw new Error('the provider names no sign-in address');
      const state = oauth.generateRandomState();
      const nonce = oauth.generateRandomNonce();
      const verifier = oauth.generateRandomCodeVerifier();
      const url = new URL(as.authorization_endpoint);
      for (const [name, value] of Object.entries(options.authorizeParams ?? {})) {
        url.searchParams.set(name, value);
      }
      const scopes = new Set(['openid', ...(options.scopes ?? ['email', 'profile'])]);
      for (const [name, value] of Object.entries({
        client_id: String(options.clientId),
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: [...scopes].join(' '),
        state,
        nonce,
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
      })) {
        url.searchParams.set(name, value);
      }
      return { location: url.href, keep: { state, nonce, verifier } };
    },
    async finish({ url, redirectUri, kept }) {
      ready();
      const { state, nonce, verifier } = kept;
      if (typeof state !== 'string' || typeof nonce !== 'string' || typeof verifier !== 'string') {
        throw new Error('nothing was kept from the start of this sign-in');
      }
      const as = await server();
      let tokens: oauth.TokenEndpointResponse;
      try {
        const answer = oauth.validateAuthResponse(as, client(), url, state);
        const response = await oauth.authorizationCodeGrantRequest(
          as,
          client(),
          oauth.ClientSecretPost(String(options.clientSecret)),
          answer,
          redirectUri,
          verifier,
          http(),
        );
        tokens = await oauth.processAuthorizationCodeResponse(as, client(), response, {
          expectedNonce: nonce,
          requireIdToken: true,
          ...(maxAge === undefined ? {} : { maxAge: Number(maxAge) }),
        });
        await oauth.validateApplicationLevelSignature(as, response, http());
      } catch (error) {
        throw withProviderReason(error);
      }
      const claims = oauth.getValidatedIdTokenClaims(tokens) as Record<string, unknown> | undefined;
      if (!claims) throw new Error('the provider sent no ID token');
      return options.identity ? options.identity(claims) : verifiedIdentity(claims);
    },
  };
}

/**
 * The error with what the provider said went wrong, such as `invalid_client` or `access_denied`
 * and its description: the difference between a wrong secret and a redirect address it does not
 * know. A provider's error names no secret.
 */
function withProviderReason(error: unknown): unknown {
  const said = error as { error?: unknown; error_description?: unknown; message?: unknown };
  if (!(error instanceof Error) || typeof said.error !== 'string') return error;
  const description =
    typeof said.error_description === 'string' ? ` (${said.error_description})` : '';
  return new Error(`${error.message}: ${said.error}${description}`, { cause: error });
}

function verifiedIdentity(claims: Readonly<Record<string, unknown>>): SignInIdentity {
  return {
    subject: typeof claims.sub === 'string' ? claims.sub : '',
    // An unverified address names nobody: only someone who signed in before gets in without one.
    email: claims.email_verified === true && typeof claims.email === 'string' ? claims.email : '',
  };
}

function isLoopbackHttp(issuer: string | undefined): boolean {
  try {
    const url = new URL(String(issuer));
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}
