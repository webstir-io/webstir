import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import type { HttpMethod, JobDefinition, RouteDefinition, SchemaReference } from '@webstir-io/module-contract';

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const ALLOWED_SCHEMA_KINDS = ['zod', 'json-schema', 'ts-rest'] as const;
const ALLOWED_SCHEDULE_MACROS = [
  'yearly',
  'annually',
  'monthly',
  'weekly',
  'daily',
  'midnight',
  'hourly',
  'reboot',
] as const;

interface WorkspacePackageJson {
  readonly webstir?: {
    readonly moduleManifest?: {
      readonly routes?: RouteDefinition[];
      readonly jobs?: JobDefinition[];
      readonly [key: string]: unknown;
    };
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

type MutableWorkspacePackageJson = WorkspacePackageJson & {
  webstir?: Record<string, unknown>;
  [key: string]: unknown;
};

export interface AddRouteOptions {
  readonly workspaceRoot: string;
  readonly name: string;
  readonly method?: string;
  readonly path?: string;
  readonly fastify?: boolean;
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly paramsSchema?: string;
  readonly querySchema?: string;
  readonly bodySchema?: string;
  readonly headersSchema?: string;
  readonly responseSchema?: string;
  readonly responseStatus?: string | number;
  readonly responseHeadersSchema?: string;
}

export interface AddJobOptions {
  readonly workspaceRoot: string;
  readonly name: string;
  readonly schedule?: string;
  readonly description?: string;
  readonly priority?: string;
}

export interface BackendAddResult {
  readonly subject: 'route' | 'job';
  readonly target: string;
  readonly changes: readonly string[];
}

export async function runAddRoute(options: AddRouteOptions): Promise<BackendAddResult> {
  const name = normalizeRequiredName(options.name, 'route');
  const method = normalizeMethod(options.method);
  const routePath = normalizeRoutePath(options.path, name);
  const fastify = options.fastify === true;
  const summary = normalizeOptionalString(options.summary);
  const description = normalizeOptionalString(options.description);
  const tags = normalizeTags(options.tags);
  const paramsSchema = parseSchemaReference(options.paramsSchema, '--params-schema');
  const querySchema = parseSchemaReference(options.querySchema, '--query-schema');
  const bodySchema = parseSchemaReference(options.bodySchema, '--body-schema');
  const headersSchema = parseSchemaReference(options.headersSchema, '--headers-schema');
  const responseSchema = parseSchemaReference(options.responseSchema, '--response-schema');
  const responseHeadersSchema = parseSchemaReference(options.responseHeadersSchema, '--response-headers-schema');
  const responseStatus = parseResponseStatus(options.responseStatus);

  if ((responseHeadersSchema || responseStatus !== undefined) && !responseSchema) {
    throw new Error('--response-schema is required when setting response headers or status.');
  }

  const packageJsonPath = path.join(options.workspaceRoot, 'package.json');
  const routeFilePath = path.join(options.workspaceRoot, 'src', 'backend', 'server', 'routes', `${name}.ts`);
  const fastifyFilePath = path.join(options.workspaceRoot, 'src', 'backend', 'server', 'fastify.ts');
  const trackedPaths = fastify ? [packageJsonPath, routeFilePath, fastifyFilePath] : [packageJsonPath];
  const before = await captureFileState(trackedPaths);

  const pkg = await readWorkspacePackageJson(packageJsonPath);
  const webstir = asObject(pkg.webstir);
  const moduleManifest = asObject(webstir.moduleManifest);
  const routes = Array.isArray(moduleManifest.routes) ? [...moduleManifest.routes] : [];
  const routeIndex = routes.findIndex((entry) => entry?.method === method && entry?.path === routePath);

  const nextRoute: RouteDefinition = {
    name,
    method,
    path: routePath,
    ...(summary ? { summary } : {}),
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(buildRouteInput(paramsSchema, querySchema, bodySchema, headersSchema)),
    ...(buildRouteOutput(responseSchema, responseHeadersSchema, responseStatus)),
  };

  if (routeIndex >= 0) {
    routes[routeIndex] = nextRoute;
  } else {
    routes.push(nextRoute);
  }

  moduleManifest.routes = routes;
  webstir.moduleManifest = moduleManifest;
  pkg.webstir = webstir;
  await writeWorkspacePackageJson(packageJsonPath, pkg);

  if (fastify) {
    await scaffoldFastifyRoute(options.workspaceRoot, name, method, routePath);
  }

  return {
    subject: 'route',
    target: `${method} ${routePath}`,
    changes: await collectChangedFiles(options.workspaceRoot, trackedPaths, before),
  };
}

export async function runAddJob(options: AddJobOptions): Promise<BackendAddResult> {
  const name = normalizeRequiredName(options.name, 'job');
  const schedule = normalizeOptionalString(options.schedule);
  const description = normalizeOptionalString(options.description);
  const priority = normalizeOptionalString(options.priority);

  if (schedule) {
    validateSchedule(schedule);
  }

  const packageJsonPath = path.join(options.workspaceRoot, 'package.json');
  const jobDirectory = path.join(options.workspaceRoot, 'src', 'backend', 'jobs', name);
  const jobFilePath = path.join(jobDirectory, 'index.ts');
  const trackedPaths = [packageJsonPath, jobFilePath];
  const before = await captureFileState(trackedPaths);

  if (existsSync(jobDirectory)) {
    throw new Error(`Job '${name}' already exists.`);
  }

  await mkdir(jobDirectory, { recursive: true });
  await writeFile(jobFilePath, buildJobTemplate(name), 'utf8');

  const pkg = await readWorkspacePackageJson(packageJsonPath);
  const webstir = asObject(pkg.webstir);
  const moduleManifest = asObject(webstir.moduleManifest);
  const jobs = Array.isArray(moduleManifest.jobs) ? [...moduleManifest.jobs] : [];
  const jobIndex = jobs.findIndex((entry) => entry?.name === name);

  const nextJob: JobDefinition & { description?: string } = {
    name,
    ...(schedule ? { schedule } : {}),
    ...(description ? { description } : {}),
    ...(parsePriority(priority)),
  };

  if (jobIndex >= 0) {
    jobs[jobIndex] = nextJob;
  } else {
    jobs.push(nextJob);
  }

  moduleManifest.jobs = jobs;
  webstir.moduleManifest = moduleManifest;
  pkg.webstir = webstir;
  await writeWorkspacePackageJson(packageJsonPath, pkg);

  return {
    subject: 'job',
    target: name,
    changes: await collectChangedFiles(options.workspaceRoot, trackedPaths, before),
  };
}

function buildRouteInput(
  paramsSchema?: SchemaReference,
  querySchema?: SchemaReference,
  bodySchema?: SchemaReference,
  headersSchema?: SchemaReference
): { input?: RouteDefinition['input'] } {
  const input = {
    ...(paramsSchema ? { params: paramsSchema } : {}),
    ...(querySchema ? { query: querySchema } : {}),
    ...(bodySchema ? { body: bodySchema } : {}),
    ...(headersSchema ? { headers: headersSchema } : {}),
  };

  return Object.keys(input).length > 0 ? { input } : {};
}

function buildRouteOutput(
  responseSchema?: SchemaReference,
  responseHeadersSchema?: SchemaReference,
  responseStatus?: number
): { output?: RouteDefinition['output'] } {
  if (!responseSchema) {
    return {};
  }

  return {
    output: {
      body: responseSchema,
      ...(responseStatus !== undefined ? { status: responseStatus } : {}),
      ...(responseHeadersSchema ? { headers: responseHeadersSchema } : {}),
    },
  };
}

async function scaffoldFastifyRoute(
  workspaceRoot: string,
  name: string,
  method: HttpMethod,
  routePath: string
): Promise<void> {
  const routeDirectory = path.join(workspaceRoot, 'src', 'backend', 'server', 'routes');
  await mkdir(routeDirectory, { recursive: true });

  const routeFilePath = path.join(routeDirectory, `${name}.ts`);
  if (!existsSync(routeFilePath)) {
    await writeFile(routeFilePath, buildFastifyRouteTemplate(name, method, routePath), 'utf8');
  }

  const fastifyPath = path.join(workspaceRoot, 'src', 'backend', 'server', 'fastify.ts');
  if (existsSync(fastifyPath)) {
    await patchFastifyRegistration(fastifyPath, name);
  }
}

async function patchFastifyRegistration(fastifyPath: string, name: string): Promise<void> {
  let content = await readFile(fastifyPath, 'utf8');
  const importLine = `import { register as register${toPascal(name)} } from './routes/${name}';`;
  const callLine = `  register${toPascal(name)}(app);`;

  if (!content.includes(importLine)) {
    const fastifyImport = "import Fastify from 'fastify';";
    const anchor = content.indexOf(fastifyImport);
    if (anchor >= 0) {
      const lineEnd = content.indexOf('\n', anchor);
      if (lineEnd >= 0) {
        content = `${content.slice(0, lineEnd + 1)}${importLine}\n${content.slice(lineEnd + 1)}`;
      }
    }
  }

  if (!content.includes(callLine)) {
    const healthAnchor = "app.get('/api/health'";
    const appAnchor = 'const app = Fastify';
    const insertAnchor = content.indexOf(healthAnchor);
    if (insertAnchor >= 0) {
      const lineEnd = content.indexOf('\n', insertAnchor);
      if (lineEnd >= 0) {
        content = `${content.slice(0, lineEnd + 1)}${callLine}\n${content.slice(lineEnd + 1)}`;
      }
    } else {
      const appIndex = content.indexOf(appAnchor);
      if (appIndex >= 0) {
        const lineEnd = content.indexOf('\n', appIndex);
        if (lineEnd >= 0) {
          content = `${content.slice(0, lineEnd + 1)}${callLine}\n${content.slice(lineEnd + 1)}`;
        }
      }
    }
  }

  await writeFile(fastifyPath, content, 'utf8');
}

function buildFastifyRouteTemplate(name: string, method: HttpMethod, routePath: string): string {
  return `// Generated by webstir-bun add-route --fastify
export function register(app: import('fastify').FastifyInstance) {
  app.route({
    method: '${method}',
    url: '${routePath}',
    handler: async (_req, reply) => {
      reply.code(200).send({ ok: true, route: '${name}' });
    }
  });
}
`;
}

function buildJobTemplate(name: string): string {
  return `// Generated by webstir-bun add-job
export async function run(): Promise<void> {
  console.info('[job:${name}] ran at', new Date().toISOString());
}

const isMain = (() => {
  try {
    const argv1 = process.argv?.[1];
    if (!argv1) return false;
    const here = new URL(import.meta.url);
    const run = new URL(\`file://\${argv1}\`);
    return here.pathname === run.pathname;
  } catch {
    return false;
  }
})();

if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
`;
}

function normalizeRequiredName(name: string, subject: 'route' | 'job'): string {
  const normalized = name.trim();
  if (!normalized) {
    throw new Error(`Missing ${subject} name.`);
  }
  return normalized;
}

function normalizeMethod(value?: string): HttpMethod {
  const candidate = (value ?? 'GET').trim().toUpperCase();
  if (!ALLOWED_METHODS.includes(candidate as HttpMethod)) {
    throw new Error(`Invalid --method value '${candidate}'. Allowed values: ${ALLOWED_METHODS.join(', ')}.`);
  }
  return candidate as HttpMethod;
}

function normalizeRoutePath(value: string | undefined, name: string): string {
  const routePath = (value?.trim() || `/api/${name}`);
  return routePath.startsWith('/') ? routePath : `/${routePath}`;
}

function normalizeOptionalString(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags || tags.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const candidate = tag.trim();
    if (!candidate) {
      continue;
    }

    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(candidate);
  }

  return normalized;
}

function parseSchemaReference(value: string | undefined, flag: string): SchemaReference | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  let kind = 'zod';
  let remainder = trimmed;
  const colonIndex = trimmed.indexOf(':');
  if (colonIndex >= 0) {
    if (colonIndex === 0) {
      throw new Error(`Invalid ${flag} value '${value}'. Missing schema name.`);
    }
    kind = trimmed.slice(0, colonIndex).trim().toLowerCase();
    remainder = trimmed.slice(colonIndex + 1);
  }

  let source: string | undefined;
  const atIndex = remainder.indexOf('@');
  if (atIndex >= 0) {
    source = remainder.slice(atIndex + 1).trim();
    remainder = remainder.slice(0, atIndex);
  }

  const name = remainder.trim();
  if (!name) {
    throw new Error(`Invalid ${flag} value '${value}'. Schema name is required.`);
  }

  if (!ALLOWED_SCHEMA_KINDS.includes(kind as (typeof ALLOWED_SCHEMA_KINDS)[number])) {
    throw new Error(`Invalid schema kind '${kind}' in ${flag}. Allowed kinds: ${ALLOWED_SCHEMA_KINDS.join(', ')}.`);
  }

  return {
    kind: kind as SchemaReference['kind'],
    name,
    ...(source ? { source } : {}),
  };
}

function parseResponseStatus(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = typeof value === 'number' ? String(value) : value.trim();
  if (!raw) {
    return undefined;
  }

  const status = Number.parseInt(raw, 10);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error(`Invalid --response-status value '${raw}'. Status must be between 100 and 599.`);
  }

  return status;
}

function parsePriority(priority: string | undefined): { priority?: number | string } {
  if (!priority) {
    return {};
  }

  const numeric = Number.parseInt(priority, 10);
  if (Number.isInteger(numeric) && String(numeric) === priority) {
    return { priority: numeric };
  }

  return { priority };
}

function validateSchedule(schedule: string): void {
  const trimmed = schedule.trim();
  if (!trimmed) {
    throw new Error('--schedule value cannot be empty or whitespace.');
  }

  if (trimmed.startsWith('@')) {
    const macro = trimmed.slice(1);
    if (!ALLOWED_SCHEDULE_MACROS.includes(macro.toLowerCase() as (typeof ALLOWED_SCHEDULE_MACROS)[number])) {
      throw new Error(`Invalid --schedule value '${schedule}'. Allowed macros: ${ALLOWED_SCHEDULE_MACROS.map((value) => `@${value}`).join(', ')}.`);
    }
    return;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 5 || parts.length > 7) {
    throw new Error(`Invalid --schedule value '${schedule}'. Expected 5-7 space-separated fields or @macro.`);
  }

  for (const part of parts) {
    if (!isValidCronField(part)) {
      throw new Error(`Invalid cron field '${part}' in --schedule value '${schedule}'.`);
    }
  }
}

function isValidCronField(field: string): boolean {
  for (const character of field) {
    if (/[A-Za-z0-9]/.test(character)) {
      continue;
    }

    if ('*/, -?#LWC'.includes(character)) {
      continue;
    }

    return false;
  }

  return true;
}

async function readWorkspacePackageJson(packageJsonPath: string): Promise<MutableWorkspacePackageJson> {
  if (!existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in workspace root.`);
  }

  return JSON.parse(await readFile(packageJsonPath, 'utf8')) as MutableWorkspacePackageJson;
}

async function writeWorkspacePackageJson(packageJsonPath: string, pkg: Record<string, unknown>): Promise<void> {
  await writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

function asObject(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null ? { ...(value as Record<string, unknown>) } : {};
}

async function captureFileState(absolutePaths: readonly string[]): Promise<Map<string, string | null>> {
  const state = new Map<string, string | null>();
  for (const absolutePath of absolutePaths) {
    state.set(absolutePath, await readFileIfExists(absolutePath));
  }
  return state;
}

async function collectChangedFiles(
  workspaceRoot: string,
  absolutePaths: readonly string[],
  before: ReadonlyMap<string, string | null>
): Promise<string[]> {
  const changes: string[] = [];
  for (const absolutePath of absolutePaths) {
    const current = await readFileIfExists(absolutePath);
    if (current !== before.get(absolutePath)) {
      changes.push(path.relative(workspaceRoot, absolutePath).replaceAll(path.sep, '/'));
    }
  }
  return changes;
}

async function readFileIfExists(absolutePath: string): Promise<string | null> {
  if (!existsSync(absolutePath)) {
    return null;
  }

  return await readFile(absolutePath, 'utf8');
}

function toPascal(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
