import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface AuthSecrets {
  jwtSecret?: string;
  jwtIssuer?: string;
  jwtAudience?: string;
  serviceTokens: string[];
}

export interface LoggingConfig {
  level: LogLevel;
  serviceName: string;
}

export interface MetricsConfig {
  enabled: boolean;
  windowSize: number;
}

export interface DatabaseConfig {
  url: string;
  migrationsTable: string;
}

export interface HttpConfig {
  bodyLimitBytes: number;
}

export interface SessionConfig {
  secret: string;
  cookieName: string;
  secure: boolean;
  maxAgeSeconds: number;
}

export interface AppEnv {
  NODE_ENV: string;
  PORT: number;
  API_BASE_URL: string;
  auth: AuthSecrets;
  logging: LoggingConfig;
  metrics: MetricsConfig;
  database: DatabaseConfig;
  http: HttpConfig;
  sessions: SessionConfig;
}

const ENV_FILES = ['.env.local', '.env'];
const WORKSPACE_ROOT_PATTERN = /^(.*)[/\\](?:src|build)[/\\]backend(?:[/\\].*)?$/;
const WORKSPACE_ROOT = resolveWorkspaceRoot();
const DEFAULT_REQUEST_BODY_MAX_BYTES = 1024 * 1024;
const GENERATED_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
let envLoaded = false;

export function loadEnv(): AppEnv {
  if (!envLoaded) {
    loadEnvFiles();
    envLoaded = true;
  }

  const NODE_ENV = process.env.NODE_ENV ?? 'development';
  const PORT = parsePort(process.env.PORT ?? '4000');
  const API_BASE_URL = requireEnv('API_BASE_URL', 'http://localhost:4000');
  const auth: AuthSecrets = {
    jwtSecret: process.env.AUTH_JWT_SECRET,
    jwtIssuer: process.env.AUTH_JWT_ISSUER,
    jwtAudience: process.env.AUTH_JWT_AUDIENCE,
    serviceTokens: parseList(process.env.AUTH_SERVICE_TOKENS)
  };
  const logging: LoggingConfig = {
    level: parseLogLevel(process.env.LOG_LEVEL),
    serviceName: process.env.LOG_SERVICE_NAME ?? 'backend-template'
  };
  const metrics: MetricsConfig = {
    enabled: parseBoolean(process.env.METRICS_ENABLED, true),
    windowSize: parsePositiveInt(process.env.METRICS_WINDOW, 200)
  };
  const database: DatabaseConfig = {
    url: process.env.DATABASE_URL ?? 'file:./data/dev.sqlite',
    migrationsTable: process.env.DATABASE_MIGRATIONS_TABLE ?? '_webstir_migrations'
  };
  const http: HttpConfig = {
    bodyLimitBytes: parsePositiveInt(process.env.REQUEST_BODY_MAX_BYTES, DEFAULT_REQUEST_BODY_MAX_BYTES)
  };
  const sessions: SessionConfig = {
    secret: resolveSessionSecret(),
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'webstir_session',
    secure: parseBoolean(process.env.SESSION_COOKIE_SECURE, NODE_ENV === 'production'),
    maxAgeSeconds: parsePositiveInt(process.env.SESSION_MAX_AGE, 60 * 60 * 24)
  };

  return {
    NODE_ENV,
    PORT,
    API_BASE_URL,
    auth,
    logging,
    metrics,
    database,
    http,
    sessions
  };
}

function resolveSessionSecret(): string {
  return process.env.SESSION_SECRET ?? process.env.AUTH_JWT_SECRET ?? GENERATED_SESSION_SECRET;
}

function loadEnvFiles(): void {
  for (const file of ENV_FILES) {
    const full = path.resolve(WORKSPACE_ROOT, file);
    if (!existsSync(full)) continue;
    try {
      applyEnvFile(full);
    } catch (error) {
      console.warn(`[webstir-backend] failed to load ${file}: ${(error as Error).message}`);
    }
  }
}

function applyEnvFile(filePath: string): void {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function parsePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 4000;
  }
  return parsed;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = (value ?? 'info').toLowerCase();
  if (normalized === 'trace' || normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error' || normalized === 'fatal') {
    return normalized;
  }
  return 'info';
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

export function resolveWorkspaceRoot(): string {
  const envWorkspaceRoot = resolveEnvWorkspaceRoot(process.env);
  if (envWorkspaceRoot) {
    return path.resolve(envWorkspaceRoot);
  }
  const inferredRoot = inferWorkspaceRootFromImportMetaUrl(import.meta.url);
  if (inferredRoot) {
    return inferredRoot;
  }
  return path.resolve(process.cwd());
}

function resolveEnvWorkspaceRoot(env: NodeJS.ProcessEnv): string | undefined {
  const workspaceRoot = env.WORKSPACE_ROOT?.trim();
  if (workspaceRoot) {
    return workspaceRoot;
  }

  const webstirWorkspaceRoot = env.WEBSTIR_WORKSPACE_ROOT?.trim();
  return webstirWorkspaceRoot || undefined;
}

function inferWorkspaceRootFromImportMetaUrl(importMetaUrl: string): string | undefined {
  try {
    return inferWorkspaceRootFromFilePath(fileURLToPath(importMetaUrl));
  } catch {
    return undefined;
  }
}

function inferWorkspaceRootFromFilePath(filePath: string): string | undefined {
  const normalizedFilePath = path.resolve(path.dirname(filePath));
  const match = normalizedFilePath.match(WORKSPACE_ROOT_PATTERN);
  if (!match) {
    return undefined;
  }

  return match[1] || path.parse(normalizedFilePath).root;
}
