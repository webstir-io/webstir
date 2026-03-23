import crypto from 'node:crypto';
import type http from 'node:http';

import type { AuthSecrets } from '../env.js';

export interface AuthContext {
  source: 'jwt' | 'service-token';
  token: string;
  userId?: string;
  email?: string;
  name?: string;
  scopes: readonly string[];
  roles: readonly string[];
  claims: Record<string, unknown>;
}

interface JwtHeader extends Record<string, unknown> {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface CachedJwkKey {
  kid?: string;
  key: crypto.KeyObject;
}

interface CachedJwksEntry {
  keys: readonly CachedJwkKey[];
  expiresAt: number;
}

const DEFAULT_JWKS_CACHE_MS = 5 * 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5_000;
const jwksCache = new Map<string, CachedJwksEntry>();
const jwksFetches = new Map<string, Promise<readonly CachedJwkKey[]>>();
const publicKeyCache = new Map<string, crypto.KeyObject>();

export async function resolveRequestAuth(
  req: http.IncomingMessage,
  secrets: AuthSecrets,
  logger?: { warn?(message: string, metadata?: Record<string, unknown>): void },
): Promise<AuthContext | undefined> {
  const bearer = getHeader(req, 'authorization');
  if (bearer?.startsWith('Bearer ')) {
    if (!hasJwtVerificationSecrets(secrets)) {
      logger?.warn?.('Authorization header provided but no JWT verification config is set.');
    } else {
      const token = bearer.slice(7).trim();
      const context = await verifyJwtToken(token, secrets);
      if (context) {
        return context;
      }
      logger?.warn?.('Bearer token validation failed', { reason: 'invalid_token' });
    }
  }

  const serviceToken = getHeader(req, 'x-service-token') ?? getHeader(req, 'x-api-key');
  if (serviceToken && secrets.serviceTokens.length > 0) {
    if (secrets.serviceTokens.includes(serviceToken)) {
      return {
        source: 'service-token',
        token: serviceToken,
        scopes: ['service'],
        roles: ['service'],
        claims: {},
        userId: undefined,
        email: undefined,
        name: undefined,
      };
    }
    logger?.warn?.('Service token did not match any allowed AUTH_SERVICE_TOKENS entry');
  }

  return undefined;
}

function hasJwtVerificationSecrets(secrets: AuthSecrets): boolean {
  return Boolean(secrets.jwtSecret || secrets.jwtPublicKey || secrets.jwksUrl);
}

async function verifyJwtToken(
  token: string,
  secrets: AuthSecrets,
): Promise<AuthContext | undefined> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const header = decodeSegment<JwtHeader>(encodedHeader);
  if (!header?.alg) {
    return undefined;
  }

  const payload = decodeSegment<Record<string, unknown>>(encodedPayload);
  if (!payload) {
    return undefined;
  }

  const signedContent = `${encodedHeader}.${encodedPayload}`;
  const signatureBuffer = decodeBase64Url(signature);
  if (!signatureBuffer) {
    return undefined;
  }

  const verified =
    header.alg === 'HS256'
      ? verifyHmacSignature(signedContent, signature, secrets.jwtSecret)
      : header.alg === 'RS256'
        ? await verifyRsaSignature(signedContent, signatureBuffer, header, secrets)
        : false;

  if (!verified) {
    return undefined;
  }

  if (secrets.jwtIssuer && payload.iss !== secrets.jwtIssuer) {
    return undefined;
  }

  if (secrets.jwtAudience && !audienceMatches(payload.aud, secrets.jwtAudience)) {
    return undefined;
  }

  const now = Date.now() / 1000;
  if (!isValidTimeClaims(payload, now)) {
    return undefined;
  }

  const scopes = normalizeScopes(payload.scope);
  const roles = normalizeRoles(
    payload.roles ?? payload.role ?? payload['https://schemas.webstir.dev/roles'],
  );

  return {
    source: 'jwt',
    token,
    userId: typeof payload.sub === 'string' ? payload.sub : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    scopes,
    roles,
    claims: payload,
  };
}

function verifyHmacSignature(signedContent: string, signature: string, secret?: string): boolean {
  if (!secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedContent)
    .digest('base64url');
  return timingSafeEqual(signature, expectedSignature);
}

async function verifyRsaSignature(
  signedContent: string,
  signature: Buffer,
  header: JwtHeader,
  secrets: AuthSecrets,
): Promise<boolean> {
  if (secrets.jwtPublicKey) {
    const publicKey = getConfiguredPublicKey(secrets.jwtPublicKey);
    if (publicKey && verifyWithPublicKey(signedContent, signature, publicKey)) {
      return true;
    }
  }

  if (!secrets.jwksUrl) {
    return false;
  }

  const jwksKeys = await getJwksKeys(secrets.jwksUrl);
  const initialCandidates = selectJwksCandidates(jwksKeys, header);
  for (const candidate of initialCandidates) {
    if (verifyWithPublicKey(signedContent, signature, candidate.key)) {
      return true;
    }
  }

  if (!header.kid) {
    return false;
  }

  const refreshedKeys = await getJwksKeys(secrets.jwksUrl, { forceRefresh: true });
  for (const candidate of selectJwksCandidates(refreshedKeys, header)) {
    if (verifyWithPublicKey(signedContent, signature, candidate.key)) {
      return true;
    }
  }

  return false;
}

function verifyWithPublicKey(
  signedContent: string,
  signature: Buffer,
  publicKey: crypto.KeyObject,
): boolean {
  try {
    return crypto.verify('RSA-SHA256', Buffer.from(signedContent), publicKey, signature);
  } catch {
    return false;
  }
}

function getConfiguredPublicKey(value: string): crypto.KeyObject | undefined {
  const cached = publicKeyCache.get(value);
  if (cached) {
    return cached;
  }

  try {
    const trimmed = value.trim();
    const key = trimmed.startsWith('{')
      ? crypto.createPublicKey({ key: JSON.parse(trimmed) as crypto.JsonWebKey, format: 'jwk' })
      : crypto.createPublicKey(trimmed);
    publicKeyCache.set(value, key);
    return key;
  } catch {
    return undefined;
  }
}

function selectJwksCandidates(
  keys: readonly CachedJwkKey[],
  header: JwtHeader,
): readonly CachedJwkKey[] {
  if (header.kid) {
    return keys.filter((key) => key.kid === header.kid);
  }

  return keys;
}

async function getJwksKeys(
  url: string,
  options: { forceRefresh?: boolean } = {},
): Promise<readonly CachedJwkKey[]> {
  if (options.forceRefresh) {
    jwksCache.delete(url);
  }

  const cached = jwksCache.get(url);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.keys;
  }

  const pending = jwksFetches.get(url);
  if (pending) {
    return await pending;
  }

  const fetchPromise = fetchJwksKeys(url, cached?.keys ?? []).finally(() => {
    jwksFetches.delete(url);
  });
  jwksFetches.set(url, fetchPromise);
  return await fetchPromise;
}

async function fetchJwksKeys(
  url: string,
  fallbackKeys: readonly CachedJwkKey[],
): Promise<readonly CachedJwkKey[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JWKS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`JWKS request failed with status ${response.status}`);
    }

    const body = (await response.json()) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    const resolvedKeys = keys
      .map((key) => jwkToCachedKey(key))
      .filter((key): key is CachedJwkKey => key !== undefined);

    const ttlMs = resolveJwksCacheTtl(response.headers);
    jwksCache.set(url, {
      keys: resolvedKeys,
      expiresAt: Date.now() + ttlMs,
    });

    return resolvedKeys;
  } catch {
    if (fallbackKeys.length > 0) {
      jwksCache.set(url, {
        keys: fallbackKeys,
        expiresAt: Date.now() + DEFAULT_JWKS_CACHE_MS,
      });
      return fallbackKeys;
    }
    jwksCache.delete(url);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function jwkToCachedKey(value: unknown): CachedJwkKey | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  try {
    const jwk = value as crypto.JsonWebKey;
    const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    return {
      kid: typeof jwk.kid === 'string' ? jwk.kid : undefined,
      key,
    };
  } catch {
    return undefined;
  }
}

function resolveJwksCacheTtl(headers: Headers): number {
  const cacheControl = headers.get('cache-control');
  if (cacheControl) {
    const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
    if (maxAgeMatch) {
      const maxAgeSeconds = Number(maxAgeMatch[1]);
      if (Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0) {
        return maxAgeSeconds * 1000;
      }
    }
    if (/\bno-store\b/i.test(cacheControl)) {
      return 0;
    }
  }

  const expires = headers.get('expires');
  if (expires) {
    const expiresAt = Date.parse(expires);
    if (Number.isFinite(expiresAt)) {
      const ttl = expiresAt - Date.now();
      if (ttl > 0) {
        return ttl;
      }
    }
  }

  return DEFAULT_JWKS_CACHE_MS;
}

function decodeSegment<T extends Record<string, unknown>>(segment: string): T | undefined {
  try {
    const json = Buffer.from(segment, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): Buffer | undefined {
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return undefined;
  }
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function audienceMatches(value: unknown, expected: string): boolean {
  if (Array.isArray(value)) {
    return value.includes(expected);
  }
  if (typeof value === 'string') {
    return value === expected;
  }
  return false;
}

function isValidTimeClaims(payload: Record<string, unknown>, now: number): boolean {
  const notBefore = parseNumericDateClaim(payload.nbf);
  if (payload.nbf !== undefined && notBefore === undefined) {
    return false;
  }
  if (notBefore !== undefined && now < notBefore) {
    return false;
  }

  const expiresAt = parseNumericDateClaim(payload.exp);
  if (payload.exp !== undefined && expiresAt === undefined) {
    return false;
  }
  if (expiresAt !== undefined && now >= expiresAt) {
    return false;
  }

  return true;
}

function parseNumericDateClaim(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function normalizeScopes(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((scope) => String(scope));
  }
  if (typeof value === 'string') {
    return value
      .split(' ')
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0);
  }
  return [];
}

function normalizeRoles(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((role) => String(role));
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((role) => role.trim())
      .filter((role) => role.length > 0);
  }
  return [];
}

function getHeader(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}
