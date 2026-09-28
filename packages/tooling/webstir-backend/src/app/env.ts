import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { BunRuntimeEnvLike } from '../runtime/bun.js';
import { appRoot, isProduction } from './app-root.js';

export type AppEnv = BunRuntimeEnvLike<Record<string, never>, Record<string, never>>;

const ENV_FILES = ['.env.local', '.env'];
const DEFAULT_PORT = 4321;
const WEEK_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_BODY_LIMIT = 1_048_576;

/**
 * Loads `.env.local`, then `.env`, from the app's root. A variable already set, by the shell or an
 * earlier file, is kept.
 */
export function loadEnvFiles(workspaceRoot: string = appRoot()): void {
  for (const file of ENV_FILES) {
    const full = path.join(workspaceRoot, file);
    if (!existsSync(full)) continue;
    for (const [key, value] of parseEnvFile(readFileSync(full, 'utf8'))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function parseEnvFile(contents: string): [string, string][] {
  const entries: [string, string][] = [];
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line
      .slice(0, separator)
      .replace(/^export\s+/, '')
      .trim();
    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    entries.push([key, value]);
  }
  return entries;
}

/** The server's settings, from the environment and the app's `.env` files. */
export function loadAppEnv(workspaceRoot: string = appRoot()): AppEnv {
  loadEnvFiles(workspaceRoot);
  const production = isProduction();
  return {
    NODE_ENV: process.env.NODE_ENV?.trim() || 'development',
    PORT: readNumber('PORT', DEFAULT_PORT),
    auth: {},
    metrics: {},
    http: { bodyLimitBytes: readNumber('REQUEST_BODY_MAX_BYTES', DEFAULT_BODY_LIMIT) },
    sessions: {
      secret: sessionSecret(workspaceRoot),
      cookieName: process.env.SESSION_COOKIE_NAME?.trim() || 'webstir_session',
      secure: readSwitch('SESSION_COOKIE_SECURE', production),
      maxAgeSeconds: readNumber('SESSION_MAX_AGE', WEEK_SECONDS),
      path: '/',
      sameSite: 'Lax',
    },
  };
}

/**
 * The secret that signs session cookies and sign-in codes. Production must set SESSION_SECRET; in
 * development one is made once and kept in `.webstir/`, so sessions survive a restart.
 */
export function sessionSecret(workspaceRoot: string = appRoot()): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured) return configured;
  if (isProduction()) {
    throw new Error('SESSION_SECRET is required in production; set it to a long random value.');
  }
  const file = path.join(workspaceRoot, '.webstir', 'session-secret');
  if (existsSync(file)) {
    const kept = readFileSync(file, 'utf8').trim();
    if (kept) return kept;
  }
  const secret = randomBytes(32).toString('hex');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}

/** The address the app is reached at: APP_URL, else what the request says (development only). */
export function appUrl(request?: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (isProduction()) {
    throw new Error(
      'APP_URL is required in production; set it to the address people use, such as https://example.com.',
    );
  }
  if (!request) return `http://localhost:${process.env.PORT ?? DEFAULT_PORT}`;
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? url.host;
  const protocol = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(/:$/, '');
  return `${protocol}://${host}`;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} is "${raw}"; expected a positive number.`);
  }
  return value;
}

function readSwitch(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'on', 'yes'].includes(raw)) return true;
  if (['0', 'false', 'off', 'no'].includes(raw)) return false;
  throw new Error(`${name} is "${raw}"; expected on or off.`);
}
