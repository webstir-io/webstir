import type { AddCommandResult } from './add.ts';

import { runAddJob, runAddRoute } from '../../../packages/tooling/webstir-backend/src/add.ts';

export interface RunAddBackendOptions {
  readonly workspaceRoot: string;
  readonly rawArgs: readonly string[];
}

export async function runAddRouteCommand(options: RunAddBackendOptions): Promise<AddCommandResult> {
  const parsed = parseBackendCommandArgs(options.rawArgs, {
    valueFlags: new Set([
      '--method',
      '--path',
      '--summary',
      '--description',
      '--tags',
      '--params-schema',
      '--query-schema',
      '--body-schema',
      '--headers-schema',
      '--response-schema',
      '--response-status',
      '--response-headers-schema',
    ]),
    booleanFlags: new Set(['--fastify']),
  });

  const name = parsed.positionals[0];
  if (!name) {
    throw new Error(
      'Usage: webstir add-route <name> --workspace <path> [--method <METHOD>] [--path <path>] [--fastify].'
    );
  }

  const tags = parsed.values.get('--tags')
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const result = await runAddRoute({
    workspaceRoot: options.workspaceRoot,
    name,
    method: parsed.values.get('--method'),
    path: parsed.values.get('--path'),
    fastify: parsed.booleans.has('--fastify'),
    summary: parsed.values.get('--summary'),
    description: parsed.values.get('--description'),
    tags,
    paramsSchema: parsed.values.get('--params-schema'),
    querySchema: parsed.values.get('--query-schema'),
    bodySchema: parsed.values.get('--body-schema'),
    headersSchema: parsed.values.get('--headers-schema'),
    responseSchema: parsed.values.get('--response-schema'),
    responseStatus: parsed.values.get('--response-status'),
    responseHeadersSchema: parsed.values.get('--response-headers-schema'),
  });

  return {
    workspaceRoot: options.workspaceRoot,
    subject: 'route',
    target: result.target,
    changes: result.changes,
  };
}

export async function runAddJobCommand(options: RunAddBackendOptions): Promise<AddCommandResult> {
  const parsed = parseBackendCommandArgs(options.rawArgs, {
    valueFlags: new Set(['--schedule', '--description', '--priority']),
    booleanFlags: new Set(),
  });

  const name = parsed.positionals[0];
  if (!name) {
    throw new Error('Usage: webstir add-job <name> --workspace <path> [--schedule <expression>].');
  }

  const result = await runAddJob({
    workspaceRoot: options.workspaceRoot,
    name,
    schedule: parsed.values.get('--schedule'),
    description: parsed.values.get('--description'),
    priority: parsed.values.get('--priority'),
  });

  return {
    workspaceRoot: options.workspaceRoot,
    subject: 'job',
    target: result.target,
    changes: result.changes,
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

function parseBackendCommandArgs(rawArgs: readonly string[], spec: ParseSpec): ParsedBackendCommandArgs {
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
