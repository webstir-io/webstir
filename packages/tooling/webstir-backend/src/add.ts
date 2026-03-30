import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import type {
  FragmentUpdateMode,
  HttpMethod,
  JobDefinition,
  RouteDefinition,
  SchemaReference,
  SessionAccessMode,
} from '@webstir-io/module-contract';
import { routeDefinitionSchema } from '@webstir-io/module-contract';

import { readTextFile, writeTextFile } from './utils/bun.js';

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;
const ALLOWED_SCHEMA_KINDS = ['zod', 'json-schema', 'ts-rest'] as const;
const ALLOWED_INTERACTIONS = ['navigation', 'mutation'] as const;
const ALLOWED_SESSION_MODES = ['optional', 'required'] as const;
const ALLOWED_FRAGMENT_MODES = ['replace', 'append', 'prepend'] as const;
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
  readonly summary?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly interaction?: string;
  readonly sessionMode?: string;
  readonly sessionWrite?: boolean;
  readonly formUrlEncoded?: boolean;
  readonly formCsrf?: boolean;
  readonly fragmentTarget?: string;
  readonly fragmentSelector?: string;
  readonly fragmentMode?: string;
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
  readonly priority?: string | number;
}

export interface UpdateRouteContractOptions {
  readonly workspaceRoot: string;
  readonly method: string;
  readonly path: string;
  readonly sessionMode?: SessionAccessMode | string | null;
  readonly sessionWrite?: boolean | null;
  readonly formUrlEncoded?: boolean | null;
  readonly formCsrf?: boolean | null;
  readonly fragmentTarget?: string | null;
  readonly fragmentSelector?: string | null;
  readonly fragmentMode?: FragmentUpdateMode | string | null;
  readonly paramsSchema?: string | null;
  readonly querySchema?: string | null;
  readonly bodySchema?: string | null;
  readonly headersSchema?: string | null;
  readonly responseSchema?: string | null;
  readonly responseStatus?: string | number | null;
  readonly responseHeadersSchema?: string | null;
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
  const summary = normalizeOptionalString(options.summary);
  const description = normalizeOptionalString(options.description);
  const tags = normalizeTags(options.tags);
  const interaction = normalizeInteraction(options.interaction);
  const session = buildRouteSession(options.sessionMode, options.sessionWrite);
  const form = buildRouteForm(options.formUrlEncoded, options.formCsrf);
  const fragment = buildRouteFragment(
    options.fragmentTarget,
    options.fragmentSelector,
    options.fragmentMode,
  );
  const paramsSchema = parseSchemaReference(options.paramsSchema, '--params-schema');
  const querySchema = parseSchemaReference(options.querySchema, '--query-schema');
  const bodySchema = parseSchemaReference(options.bodySchema, '--body-schema');
  const headersSchema = parseSchemaReference(options.headersSchema, '--headers-schema');
  const responseSchema = parseSchemaReference(options.responseSchema, '--response-schema');
  const responseHeadersSchema = parseSchemaReference(
    options.responseHeadersSchema,
    '--response-headers-schema',
  );
  const responseStatus = parseResponseStatus(options.responseStatus);

  if ((responseHeadersSchema || responseStatus !== undefined) && !responseSchema) {
    throw new Error('--response-schema is required when setting response headers or status.');
  }

  const packageJsonPath = path.join(options.workspaceRoot, 'package.json');
  const trackedPaths = [packageJsonPath];
  const before = await captureFileState(trackedPaths);

  const pkg = await readWorkspacePackageJson(packageJsonPath);
  const webstir = asObject(pkg.webstir);
  const moduleManifest = asObject(webstir.moduleManifest);
  const routes = Array.isArray(moduleManifest.routes) ? [...moduleManifest.routes] : [];
  const routeIndex = routes.findIndex(
    (entry) => entry?.method === method && entry?.path === routePath,
  );

  const nextRoute: RouteDefinition = {
    name,
    method,
    path: routePath,
    ...(summary ? { summary } : {}),
    ...(description ? { description } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(interaction ? { interaction } : {}),
    ...(session ? { session } : {}),
    ...(form ? { form } : {}),
    ...(fragment ? { fragment } : {}),
    ...buildRouteInput(paramsSchema, querySchema, bodySchema, headersSchema),
    ...buildRouteOutput(responseSchema, responseHeadersSchema, responseStatus),
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
  const priority = normalizeOptionalString(
    options.priority !== undefined ? String(options.priority) : undefined,
  );

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
  await writeTextFile(jobFilePath, buildJobTemplate(name));

  const pkg = await readWorkspacePackageJson(packageJsonPath);
  const webstir = asObject(pkg.webstir);
  const moduleManifest = asObject(webstir.moduleManifest);
  const jobs = Array.isArray(moduleManifest.jobs) ? [...moduleManifest.jobs] : [];
  const jobIndex = jobs.findIndex((entry) => entry?.name === name);

  const nextJob: JobDefinition & { description?: string } = {
    name,
    ...(schedule ? { schedule } : {}),
    ...(description ? { description } : {}),
    ...parsePriority(priority),
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

export async function runUpdateRouteContract(
  options: UpdateRouteContractOptions,
): Promise<BackendAddResult> {
  const packageJsonPath = path.join(options.workspaceRoot, 'package.json');
  const trackedPaths = [packageJsonPath];
  const before = await captureFileState(trackedPaths);
  const pkg = await readWorkspacePackageJson(packageJsonPath);
  const webstir = asObject(pkg.webstir);
  const moduleManifest = asObject(webstir.moduleManifest);
  const routes = Array.isArray(moduleManifest.routes) ? [...moduleManifest.routes] : [];
  const method = normalizeMethod(options.method);
  const routePath = normalizeExplicitRoutePath(options.path);
  const routeIndex = routes.findIndex(
    (entry) => entry?.method === method && entry?.path === routePath,
  );

  if (routeIndex < 0) {
    throw new Error(`Route '${method} ${routePath}' not found.`);
  }

  const existingRoute = routeDefinitionSchema.parse(routes[routeIndex]) as RouteDefinition;
  const nextRoute = routeDefinitionSchema.parse({
    ...existingRoute,
    ...buildUpdatedRouteContract(existingRoute, options),
  }) as RouteDefinition;

  routes[routeIndex] = nextRoute;
  moduleManifest.routes = routes;
  webstir.moduleManifest = moduleManifest;
  pkg.webstir = webstir;
  await writeWorkspacePackageJson(packageJsonPath, pkg);

  return {
    subject: 'route',
    target: `${method} ${routePath}`,
    changes: await collectChangedFiles(options.workspaceRoot, trackedPaths, before),
  };
}

function buildRouteInput(
  paramsSchema?: SchemaReference,
  querySchema?: SchemaReference,
  bodySchema?: SchemaReference,
  headersSchema?: SchemaReference,
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
  responseStatus?: number,
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

function buildUpdatedRouteContract(
  existingRoute: RouteDefinition,
  options: UpdateRouteContractOptions,
): Partial<RouteDefinition> {
  const session = buildMergedRouteSession(existingRoute, options);
  const form = buildMergedRouteForm(existingRoute, options);
  const fragment = buildMergedRouteFragment(existingRoute, options);
  const input = buildMergedRouteInput(existingRoute, options);
  const output = buildMergedRouteOutput(existingRoute, options);

  return {
    ...(session !== KEEP_VALUE ? { session } : {}),
    ...(form !== KEEP_VALUE ? { form } : {}),
    ...(fragment !== KEEP_VALUE ? { fragment } : {}),
    ...(input !== KEEP_VALUE ? { input } : {}),
    ...(output !== KEEP_VALUE ? { output } : {}),
  };
}

const KEEP_VALUE = Symbol('keep-value');

function buildMergedRouteSession(
  existingRoute: RouteDefinition,
  options: UpdateRouteContractOptions,
): RouteDefinition['session'] | typeof KEEP_VALUE {
  if (options.sessionMode === undefined && options.sessionWrite === undefined) {
    return KEEP_VALUE;
  }

  const mode =
    options.sessionMode === undefined
      ? existingRoute.session?.mode
      : normalizeNullableSessionMode(options.sessionMode);
  const write =
    options.sessionWrite === undefined
      ? existingRoute.session?.write
      : options.sessionWrite
        ? true
        : undefined;

  if (!mode && !write) {
    return undefined;
  }

  return {
    ...(mode ? { mode } : {}),
    ...(write ? { write: true } : {}),
  };
}

function buildMergedRouteForm(
  existingRoute: RouteDefinition,
  options: UpdateRouteContractOptions,
): RouteDefinition['form'] | typeof KEEP_VALUE {
  if (options.formUrlEncoded === undefined && options.formCsrf === undefined) {
    return KEEP_VALUE;
  }

  const existingForm = existingRoute.form;
  const contentType =
    options.formUrlEncoded === undefined
      ? existingForm?.contentType
      : options.formUrlEncoded
        ? 'application/x-www-form-urlencoded'
        : existingForm?.contentType === 'application/x-www-form-urlencoded'
          ? undefined
          : existingForm?.contentType;
  const csrf =
    options.formCsrf === undefined ? existingForm?.csrf : options.formCsrf ? true : undefined;
  const nextForm = {
    ...(existingForm ?? {}),
    ...(contentType ? { contentType } : {}),
    ...(csrf ? { csrf: true } : {}),
  };

  if (!contentType) {
    delete nextForm.contentType;
  }
  if (!csrf) {
    delete nextForm.csrf;
  }

  return Object.keys(nextForm).length > 0 ? nextForm : undefined;
}

function buildMergedRouteFragment(
  existingRoute: RouteDefinition,
  options: UpdateRouteContractOptions,
): RouteDefinition['fragment'] | typeof KEEP_VALUE {
  if (
    options.fragmentTarget === undefined &&
    options.fragmentSelector === undefined &&
    options.fragmentMode === undefined
  ) {
    return KEEP_VALUE;
  }

  const target =
    options.fragmentTarget === undefined
      ? existingRoute.fragment?.target
      : (options.fragmentTarget ?? undefined);
  const selector =
    options.fragmentSelector === undefined
      ? existingRoute.fragment?.selector
      : (options.fragmentSelector ?? undefined);
  const mode =
    options.fragmentMode === undefined
      ? existingRoute.fragment?.mode
      : normalizeNullableFragmentMode(options.fragmentMode);

  if (!target) {
    return undefined;
  }

  return {
    target,
    ...(selector ? { selector } : {}),
    ...(mode ? { mode } : {}),
  };
}

function buildMergedRouteInput(
  existingRoute: RouteDefinition,
  options: UpdateRouteContractOptions,
): RouteDefinition['input'] | typeof KEEP_VALUE {
  if (
    options.paramsSchema === undefined &&
    options.querySchema === undefined &&
    options.bodySchema === undefined &&
    options.headersSchema === undefined
  ) {
    return KEEP_VALUE;
  }

  const params = mergeSchemaReference(
    existingRoute.input?.params,
    options.paramsSchema,
    '--params-schema',
  );
  const query = mergeSchemaReference(
    existingRoute.input?.query,
    options.querySchema,
    '--query-schema',
  );
  const body = mergeSchemaReference(existingRoute.input?.body, options.bodySchema, '--body-schema');
  const headers = mergeSchemaReference(
    existingRoute.input?.headers,
    options.headersSchema,
    '--headers-schema',
  );

  return buildInputObject({ params, query, body, headers });
}

function buildMergedRouteOutput(
  existingRoute: RouteDefinition,
  options: UpdateRouteContractOptions,
): RouteDefinition['output'] | typeof KEEP_VALUE {
  if (
    options.responseSchema === undefined &&
    options.responseStatus === undefined &&
    options.responseHeadersSchema === undefined
  ) {
    return KEEP_VALUE;
  }

  if (existingRoute.output && 'responses' in existingRoute.output) {
    throw new Error(
      `Route '${existingRoute.method} ${existingRoute.path}' uses response variants and cannot be updated with update_route_contract.`,
    );
  }
  if (existingRoute.output && 'redirect' in existingRoute.output) {
    throw new Error(
      `Route '${existingRoute.method} ${existingRoute.path}' uses redirect output and cannot be updated with update_route_contract.`,
    );
  }

  const existingOutput =
    existingRoute.output && 'body' in existingRoute.output ? existingRoute.output : undefined;
  const body = mergeSchemaReference(
    existingOutput?.body,
    options.responseSchema,
    '--response-schema',
  );
  const headers = mergeSchemaReference(
    existingOutput?.headers,
    options.responseHeadersSchema,
    '--response-headers-schema',
  );
  const status =
    options.responseStatus === undefined
      ? existingOutput?.status
      : options.responseStatus === null
        ? undefined
        : parseResponseStatus(options.responseStatus);

  if ((headers || status !== undefined) && !body) {
    throw new Error('--response-schema is required when setting response headers or status.');
  }
  if (!body) {
    return undefined;
  }

  return {
    ...(status !== undefined ? { status } : {}),
    ...(headers ? { headers } : {}),
    body,
    ...(existingOutput && 'fragment' in existingOutput
      ? { fragment: existingOutput.fragment }
      : {}),
  };
}

function mergeSchemaReference(
  existing: SchemaReference | undefined,
  next: string | null | undefined,
  flag: string,
): SchemaReference | undefined {
  if (next === undefined) {
    return existing;
  }
  if (next === null) {
    return undefined;
  }
  return parseSchemaReference(next, flag);
}

function buildInputObject(input: {
  readonly params?: SchemaReference;
  readonly query?: SchemaReference;
  readonly body?: SchemaReference;
  readonly headers?: SchemaReference;
}): RouteDefinition['input'] {
  const next = {
    ...(input.params ? { params: input.params } : {}),
    ...(input.query ? { query: input.query } : {}),
    ...(input.body ? { body: input.body } : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeInteraction(value?: string): RouteDefinition['interaction'] | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'navigation' || normalized === 'mutation') {
    return normalized;
  }

  throw new Error(
    `Invalid --interaction value '${normalized}'. Allowed values: ${ALLOWED_INTERACTIONS.join(', ')}.`,
  );
}

function buildRouteSession(mode?: string, write?: boolean): RouteDefinition['session'] | undefined {
  const normalizedMode = normalizeSessionMode(mode);
  if (!normalizedMode && !write) {
    return undefined;
  }

  return {
    ...(normalizedMode ? { mode: normalizedMode } : {}),
    ...(write ? { write: true } : {}),
  };
}

function normalizeSessionMode(value?: string): SessionAccessMode | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'optional' || normalized === 'required') {
    return normalized;
  }

  throw new Error(
    `Invalid --session value '${normalized}'. Allowed values: ${ALLOWED_SESSION_MODES.join(', ')}.`,
  );
}

function buildRouteForm(urlEncoded?: boolean, csrf?: boolean): RouteDefinition['form'] | undefined {
  if (!urlEncoded && !csrf) {
    return undefined;
  }

  return {
    ...(urlEncoded ? { contentType: 'application/x-www-form-urlencoded' } : {}),
    ...(csrf ? { csrf: true } : {}),
  };
}

function buildRouteFragment(
  target?: string,
  selector?: string,
  mode?: string,
): RouteDefinition['fragment'] | undefined {
  const normalizedTarget = normalizeOptionalString(target);
  const normalizedSelector = normalizeOptionalString(selector);
  const normalizedMode = normalizeFragmentMode(mode);

  if (!normalizedTarget && !normalizedSelector && !normalizedMode) {
    return undefined;
  }

  if (!normalizedTarget) {
    throw new Error('--fragment-target is required when setting fragment metadata.');
  }

  return {
    target: normalizedTarget,
    ...(normalizedSelector ? { selector: normalizedSelector } : {}),
    ...(normalizedMode ? { mode: normalizedMode } : {}),
  };
}

function normalizeFragmentMode(value?: string): FragmentUpdateMode | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'replace' || normalized === 'append' || normalized === 'prepend') {
    return normalized;
  }

  throw new Error(
    `Invalid --fragment-mode value '${normalized}'. Allowed values: ${ALLOWED_FRAGMENT_MODES.join(', ')}.`,
  );
}

function normalizeNullableSessionMode(
  value: UpdateRouteContractOptions['sessionMode'],
): SessionAccessMode | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value === 'optional' || value === 'required') {
    return value;
  }

  throw new Error(
    `Invalid --session value '${value}'. Allowed values: ${ALLOWED_SESSION_MODES.join(', ')}.`,
  );
}

function normalizeNullableFragmentMode(
  value: UpdateRouteContractOptions['fragmentMode'],
): FragmentUpdateMode | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value === 'replace' || value === 'append' || value === 'prepend') {
    return value;
  }

  throw new Error(
    `Invalid --fragment-mode value '${value}'. Allowed values: ${ALLOWED_FRAGMENT_MODES.join(', ')}.`,
  );
}

function buildJobTemplate(name: string): string {
  return `// Generated by webstir add-job
export async function run(): Promise<void> {
  console.info('[job:${name}] ran at', new Date().toISOString());
}

// Execute when launched directly: \`bun build/backend/jobs/${name}/index.js\`
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
    throw new Error(
      `Invalid --method value '${candidate}'. Allowed values: ${ALLOWED_METHODS.join(', ')}.`,
    );
  }
  return candidate as HttpMethod;
}

function normalizeRoutePath(value: string | undefined, name: string): string {
  const routePath = value?.trim() || `/api/${name}`;
  return routePath.startsWith('/') ? routePath : `/${routePath}`;
}

function normalizeExplicitRoutePath(value: string): string {
  const routePath = value.trim();
  if (!routePath) {
    throw new Error('Missing route path.');
  }
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

function parseSchemaReference(
  value: string | undefined,
  flag: string,
): SchemaReference | undefined {
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
    throw new Error(
      `Invalid schema kind '${kind}' in ${flag}. Allowed kinds: ${ALLOWED_SCHEMA_KINDS.join(', ')}.`,
    );
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
    throw new Error(
      `Invalid --response-status value '${raw}'. Status must be between 100 and 599.`,
    );
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
    if (
      !ALLOWED_SCHEDULE_MACROS.includes(
        macro.toLowerCase() as (typeof ALLOWED_SCHEDULE_MACROS)[number],
      )
    ) {
      throw new Error(
        `Invalid --schedule value '${schedule}'. Allowed macros: ${ALLOWED_SCHEDULE_MACROS.map((value) => `@${value}`).join(', ')}.`,
      );
    }
    return;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 5 || parts.length > 7) {
    throw new Error(
      `Invalid --schedule value '${schedule}'. Expected 5-7 space-separated fields or @macro.`,
    );
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

async function readWorkspacePackageJson(
  packageJsonPath: string,
): Promise<MutableWorkspacePackageJson> {
  if (!existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in workspace root.`);
  }

  return JSON.parse(await readTextFile(packageJsonPath)) as MutableWorkspacePackageJson;
}

async function writeWorkspacePackageJson(
  packageJsonPath: string,
  pkg: Record<string, unknown>,
): Promise<void> {
  await writeTextFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? { ...(value as Record<string, unknown>) }
    : {};
}

async function captureFileState(
  absolutePaths: readonly string[],
): Promise<Map<string, string | null>> {
  const state = new Map<string, string | null>();
  for (const absolutePath of absolutePaths) {
    state.set(absolutePath, await readFileIfExists(absolutePath));
  }
  return state;
}

async function collectChangedFiles(
  workspaceRoot: string,
  absolutePaths: readonly string[],
  before: ReadonlyMap<string, string | null>,
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

  return await readTextFile(absolutePath);
}
