const b64url = (input) =>
  Buffer.from(typeof input === 'string' ? input : new Uint8Array(input)).toString('base64url');

const rsa = () =>
  crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );

/**
 * A small OpenID Connect provider on this machine: discovery, a sign-in address that approves
 * whoever `person` is at once, a token endpoint that checks the client and PKCE, and its keys.
 * `change` alters the ID token's claims before signing, and the other fields make it misbehave.
 */
export async function startOidcIssuer({
  clientId = 'app-client',
  clientSecret = 'app-secret',
} = {}) {
  const [keys, strangerKeys] = await Promise.all([rsa(), rsa()]);
  const jwk = { ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'k1', use: 'sig' };
  const codes = new Map();
  const issuer = {
    clientId,
    clientSecret,
    person: { sub: 'sub-ada', email: 'ada@example.com', email_verified: true },
    change: undefined,
    deny: false,
    signAsStranger: false,
    omitIdToken: false,
    tokenRequests: [],
  };

  const idToken = async (nonce) => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: issuer.url,
      aud: clientId,
      iat: now,
      exp: now + 300,
      nonce,
      ...issuer.person,
    };
    issuer.change?.(claims);
    const signed = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      (issuer.signAsStranger ? strangerKeys : keys).privateKey,
      new TextEncoder().encode(signed),
    );
    return `${signed}.${b64url(signature)}`;
  };
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === '/.well-known/openid-configuration') {
        return json({
          issuer: issuer.url,
          authorization_endpoint: `${issuer.url}/authorize`,
          token_endpoint: `${issuer.url}/token`,
          jwks_uri: `${issuer.url}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        });
      }
      if (url.pathname === '/jwks') return json({ keys: [jwk] });
      if (url.pathname === '/authorize') {
        const ask = url.searchParams;
        const back = new URL(ask.get('redirect_uri'));
        back.searchParams.set('state', ask.get('state') ?? '');
        if (issuer.deny || ask.get('client_id') !== clientId) {
          back.searchParams.set('error', 'access_denied');
        } else {
          const code = crypto.randomUUID();
          codes.set(code, {
            nonce: ask.get('nonce'),
            challenge: ask.get('code_challenge'),
            redirectUri: ask.get('redirect_uri'),
          });
          back.searchParams.set('code', code);
        }
        return new Response(null, { status: 302, headers: { location: back.href } });
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await request.text());
        issuer.tokenRequests.push(Object.fromEntries(form));
        const granted = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        const challenge = b64url(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(form.get('code_verifier') ?? ''),
          ),
        );
        if (
          !granted ||
          form.get('client_id') !== clientId ||
          form.get('client_secret') !== clientSecret ||
          form.get('redirect_uri') !== granted.redirectUri ||
          challenge !== granted.challenge
        ) {
          return json({ error: 'invalid_grant' }, 400);
        }
        return json({
          access_token: 'access',
          token_type: 'Bearer',
          ...(issuer.omitIdToken ? {} : { id_token: await idToken(granted.nonce) }),
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  issuer.url = `http://127.0.0.1:${server.port}`;
  /** Visits the sign-in address a provider's `start` gave, and returns where it sends back to. */
  issuer.approve = async (location) => {
    const response = await fetch(location, { redirect: 'manual' });
    return new URL(response.headers.get('location'));
  };
  issuer.stop = () => server.stop(true);
  return issuer;
}
