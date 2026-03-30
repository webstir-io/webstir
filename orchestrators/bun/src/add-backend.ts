import type {
  AddJobOptions,
  AddRouteOptions,
  UpdateRouteContractOptions as BackendUpdateRouteContractOptions,
} from '@webstir-io/webstir-backend';

import type { AddCommandResult } from './add.ts';

import { monorepoRoot } from './paths.ts';

export interface RunAddBackendOptions {
  readonly workspaceRoot: string;
  readonly rawArgs: readonly string[];
}

export type AddRouteScaffoldOptions = AddRouteOptions;
export type AddJobScaffoldOptions = AddJobOptions;
export type UpdateRouteContractOptions = BackendUpdateRouteContractOptions;

export async function runAddRouteCommand(options: RunAddBackendOptions): Promise<AddCommandResult> {
  return await runAddRouteScaffold({
    workspaceRoot: options.workspaceRoot,
    ...parseAddRouteScaffoldArgs(options.rawArgs),
  });
}

export async function runAddRouteScaffold(
  options: AddRouteScaffoldOptions,
): Promise<AddCommandResult> {
  const backendAdd = await loadBackendAddModule();
  const result = await backendAdd.runAddRoute(options);

  return {
    workspaceRoot: options.workspaceRoot,
    subject: 'route',
    target: result.target,
    changes: result.changes,
  };
}

export async function runAddJobCommand(options: RunAddBackendOptions): Promise<AddCommandResult> {
  return await runAddJobScaffold({
    workspaceRoot: options.workspaceRoot,
    ...parseAddJobScaffoldArgs(options.rawArgs),
  });
}

export async function runAddJobScaffold(options: AddJobScaffoldOptions): Promise<AddCommandResult> {
  const backendAdd = await loadBackendAddModule();
  const result = await backendAdd.runAddJob(options);

  return {
    workspaceRoot: options.workspaceRoot,
    subject: 'job',
    target: result.target,
    changes: result.changes,
  };
}

export async function runUpdateRouteContract(
  options: UpdateRouteContractOptions,
): Promise<AddCommandResult> {
  const backendAdd = await loadBackendAddModule();
  const result = await backendAdd.runUpdateRouteContract(options);

  return {
    workspaceRoot: options.workspaceRoot,
    subject: 'route',
    target: result.target,
    changes: result.changes,
  };
}

export function parseAddRouteScaffoldArgs(
  rawArgs: readonly string[],
): Omit<AddRouteScaffoldOptions, 'workspaceRoot'> {
  const parsed = parseBackendCommandArgs(rawArgs, {
    valueFlags: new Set([
      '--method',
      '--path',
      '--summary',
      '--description',
      '--tags',
      '--interaction',
      '--session',
      '--fragment-target',
      '--fragment-selector',
      '--fragment-mode',
      '--params-schema',
      '--query-schema',
      '--body-schema',
      '--headers-schema',
      '--response-schema',
      '--response-status',
      '--response-headers-schema',
    ]),
    booleanFlags: new Set(['--session-write', '--form-urlencoded', '--csrf']),
  });

  const name = parsed.positionals[0];
  if (!name) {
    throw new Error(
      'Usage: webstir add-route <name> --workspace <path> [--method <METHOD>] [--path <path>].',
    );
  }

  const tags = parsed.values
    .get('--tags')
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  return {
    name,
    method: parsed.values.get('--method'),
    path: parsed.values.get('--path'),
    summary: parsed.values.get('--summary'),
    description: parsed.values.get('--description'),
    tags,
    interaction: parsed.values.get('--interaction'),
    sessionMode: parsed.values.get('--session'),
    sessionWrite: parsed.booleans.has('--session-write'),
    formUrlEncoded: parsed.booleans.has('--form-urlencoded'),
    formCsrf: parsed.booleans.has('--csrf'),
    fragmentTarget: parsed.values.get('--fragment-target'),
    fragmentSelector: parsed.values.get('--fragment-selector'),
    fragmentMode: parsed.values.get('--fragment-mode'),
    paramsSchema: parsed.values.get('--params-schema'),
    querySchema: parsed.values.get('--query-schema'),
    bodySchema: parsed.values.get('--body-schema'),
    headersSchema: parsed.values.get('--headers-schema'),
    responseSchema: parsed.values.get('--response-schema'),
    responseStatus: parsed.values.get('--response-status'),
    responseHeadersSchema: parsed.values.get('--response-headers-schema'),
  };
}

export function parseAddJobScaffoldArgs(
  rawArgs: readonly string[],
): Omit<AddJobScaffoldOptions, 'workspaceRoot'> {
  const parsed = parseBackendCommandArgs(rawArgs, {
    valueFlags: new Set(['--schedule', '--description', '--priority']),
    booleanFlags: new Set(),
  });

  const name = parsed.positionals[0];
  if (!name) {
    throw new Error('Usage: webstir add-job <name> --workspace <path> [--schedule <expression>].');
  }

  return {
    name,
    schedule: parsed.values.get('--schedule'),
    description: parsed.values.get('--description'),
    priority: parsed.values.get('--priority'),
  };
}

interface ParseSpec {
  readonly valueFlags: ReadonlySet<string>;
  readonly booleanFlags: ReadonlySet<string>;
}

interface ParsedBackendCommandArgs {
  readonly positionals: readonly string[];
  readonly values: ReadonlyMap<string, string>;
  readonly booleans: ReadonlySet<string>;
}

interface BackendAddResult {
  readonly target: string;
  readonly changes: readonly string[];
}

interface BackendAddModule {
  readonly runAddRoute: (options: AddRouteOptions) => Promise<BackendAddResult>;
  readonly runAddJob: (options: AddJobOptions) => Promise<BackendAddResult>;
  readonly runUpdateRouteContract: (
    options: UpdateRouteContractOptions,
  ) => Promise<BackendAddResult>;
}

let backendAddModulePromise: Promise<BackendAddModule> | null = null;

async function loadBackendAddModule(): Promise<BackendAddModule> {
  if (backendAddModulePromise) {
    return await backendAddModulePromise;
  }

  backendAddModulePromise = import('@webstir-io/webstir-backend').then(async (module) => {
    if (
      typeof module.runAddRoute === 'function' &&
      typeof module.runAddJob === 'function' &&
      typeof module.runUpdateRouteContract === 'function'
    ) {
      return module as BackendAddModule;
    }

    if (monorepoRoot) {
      throw new Error(
        'Installed @webstir-io/webstir-backend package does not export runAddRoute/runAddJob/runUpdateRouteContract.',
      );
    }

    const compat = await import('./add-backend-compat.ts');
    return {
      async runAddRoute(options: AddRouteOptions): Promise<BackendAddResult> {
        return await compat.runAddRoute(options);
      },
      async runAddJob(options: AddJobOptions): Promise<BackendAddResult> {
        return await compat.runAddJob({
          workspaceRoot: options.workspaceRoot,
          name: options.name,
          schedule: options.schedule,
          description: options.description,
          ...(options.priority !== undefined ? { priority: String(options.priority) } : {}),
        });
      },
      async runUpdateRouteContract(): Promise<BackendAddResult> {
        throw new Error(
          'Installed @webstir-io/webstir-backend package does not export runUpdateRouteContract.',
        );
      },
    };
  });

  return await backendAddModulePromise;
}

function parseBackendCommandArgs(
  rawArgs: readonly string[],
  spec: ParseSpec,
): ParsedBackendCommandArgs {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    if (arg === '--workspace' || arg === '-w') {
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      continue;
    }

    const [flag, inlineValue] = splitInlineOption(arg);

    if (spec.booleanFlags.has(flag)) {
      booleans.add(flag);
      continue;
    }

    if (spec.valueFlags.has(flag)) {
      const value = inlineValue ?? rawArgs[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${flag}.`);
      }

      values.set(flag, value);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  return {
    positionals,
    values,
    booleans,
  };
}

function splitInlineOption(arg: string): readonly [string, string | undefined] {
  const equalsIndex = arg.indexOf('=');
  if (equalsIndex < 0) {
    return [arg, undefined];
  }

  return [arg.slice(0, equalsIndex), arg.slice(equalsIndex + 1)];
}
