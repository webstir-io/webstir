#!/usr/bin/env bun

import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runAddPageCommand, runAddTestCommand } from './add.ts';
import { runAddJobCommand, runAddRouteCommand } from './add-backend.ts';
import { runBackendInspect } from './backend-inspect.ts';
import { runEnable } from './enable.ts';
import {
  formatAddSummary,
  formatBackendInspectSummary,
  formatBuildSummary,
  formatEnableSummary,
  formatInitSummary,
  formatPublishSummary,
  formatRepairSummary,
  formatRefreshSummary,
  formatSmokeSummary,
  formatTestSummary,
} from './format.ts';
import { runInit } from './init.ts';
import { runRepair } from './repair.ts';
import { runRefresh } from './refresh.ts';
import { runBuild } from './build.ts';
import { runPublish } from './publish.ts';
import { runSmoke } from './smoke.ts';
import { runTest } from './test.ts';
import { runWatch } from './watch.ts';
import type { FrontendWatchRuntime } from './types.ts';

interface CliStream {
  write(message: string): void;
}

interface CliIo {
  readonly stdout: CliStream;
  readonly stderr: CliStream;
}

const HELP_TEXT = `Usage:
  webstir init <mode> <directory>
  webstir init <directory>
  webstir add-page <name> --workspace <path>
  webstir add-test <name-or-path> --workspace <path>
  webstir add-route <name> --workspace <path> [--method <METHOD>] [--path <path>] [--fastify]
  webstir add-job <name> --workspace <path> [--schedule <expression>]
  webstir backend-inspect --workspace <path>
  webstir test --workspace <path> [--runtime <frontend|backend|all>]
  webstir smoke [--workspace <path>]
  webstir build --workspace <path>
  webstir publish --workspace <path>
  webstir enable <feature> [feature-args...] --workspace <path>
  webstir repair --workspace <path> [--dry-run]
  webstir refresh <mode> --workspace <path>
  webstir watch --workspace <path> [--host <host>] [--port <port>] [--frontend-runtime <legacy|bun>]

Commands:
  init       Scaffold a new Webstir workspace.
  add-page   Scaffold a frontend page in an existing workspace.
  add-test   Scaffold a test file in an existing workspace.
  add-route  Scaffold a backend route in an existing workspace.
  add-job    Scaffold a backend job in an existing workspace.
  backend-inspect  Inspect the backend manifest for an existing workspace.
  test       Build and run workspace tests with the Bun orchestrator.
  smoke      Run an end-to-end Bun orchestrator verification flow.
  build      Build a Webstir workspace with the Bun orchestrator.
  publish    Publish a Webstir workspace with the Bun orchestrator.
  enable     Scaffold an optional Webstir feature into a workspace.
  repair     Restore missing scaffold-managed workspace files.
  refresh    Reset and re-scaffold an existing workspace directory.
  watch      Run the Bun dev loop for a supported Webstir workspace.

Options:
  -w, --workspace <path>   Workspace root to operate on.
  --host <host>            Dev host or bind address (default: 127.0.0.1).
  --port <port>            Dev port (SPA default: 8088, API default: 4321).
  --frontend-runtime <runtime>
                           Frontend watch runtime (legacy|bun, default: bun except ssg stays legacy).
  --dry-run                Report repair changes without writing files.
  -v, --verbose            Enable verbose frontend watch diagnostics.
  --hmr-verbose            Enable detailed hot-update diagnostics.
  -h, --help               Show this help text.
`;

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  const [command, ...rest] = argv;
  if (
    command !== 'init'
    && command !== 'add-page'
    && command !== 'add-test'
    && command !== 'add-route'
    && command !== 'add-job'
    && command !== 'backend-inspect'
    && command !== 'test'
    && command !== 'smoke'
    && command !== 'build'
    && command !== 'publish'
    && command !== 'enable'
    && command !== 'repair'
    && command !== 'refresh'
    && command !== 'watch'
  ) {
    io.stderr.write(`Unknown command "${command}".\n\n${HELP_TEXT}`);
    return 1;
  }

  const options = parseCommandOptions(rest, {
    allowUnknownOptions: command === 'add-route' || command === 'add-job',
  });
  if (options.help) {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  if (options.error) {
    io.stderr.write(`${options.error}\n\n${HELP_TEXT}`);
    return 1;
  }

  if (command !== 'repair' && options.dryRun) {
    io.stderr.write(`Only repair accepts --dry-run.\n\n${HELP_TEXT}`);
    return 1;
  }

  const workspaceRoot = options.workspaceRoot;
  if (command !== 'init' && command !== 'smoke' && !workspaceRoot) {
    io.stderr.write(`Missing required --workspace <path>.\n\n${HELP_TEXT}`);
    return 1;
  }

  try {
    if (command === 'init') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Init does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runInit({
        args: options.positionals,
        workspaceRoot,
      });
      io.stdout.write(`${formatInitSummary(result)}\n`);
      return 0;
    }

    const resolvedWorkspaceRoot = workspaceRoot ? path.resolve(workspaceRoot) : undefined;
    if (command === 'add-page') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Add-page does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runAddPageCommand({
        workspaceRoot: resolvedWorkspaceRoot!,
        args: options.positionals,
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-page complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`
      );
      return 0;
    }

    if (command === 'add-test') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Add-test does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runAddTestCommand({
        workspaceRoot: resolvedWorkspaceRoot!,
        args: options.positionals,
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-test complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`
      );
      return 0;
    }

    if (command === 'add-route') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Add-route does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runAddRouteCommand({
        workspaceRoot: resolvedWorkspaceRoot!,
        rawArgs: options.rawArgs,
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-route complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`
      );
      return 0;
    }

    if (command === 'add-job') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Add-job does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runAddJobCommand({
        workspaceRoot: resolvedWorkspaceRoot!,
        rawArgs: options.rawArgs,
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-job complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`
      );
      return 0;
    }

    if (command === 'backend-inspect') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Backend-inspect does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Backend-inspect does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runBackendInspect({
        workspaceRoot: resolvedWorkspaceRoot!,
      });
      io.stdout.write(`${formatBackendInspectSummary(result)}\n`);
      return 0;
    }

    if (command === 'test') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Test does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runTest({
        workspaceRoot: resolvedWorkspaceRoot!,
        rawArgs: options.rawArgs,
      });
      io.stdout.write(`${formatTestSummary(result)}\n`);
      return result.hadFailures ? 1 : 0;
    }

    if (command === 'smoke') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Smoke does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Smoke does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runSmoke({
        workspaceRoot: resolvedWorkspaceRoot,
      });
      io.stdout.write(`${formatSmokeSummary(result)}\n`);
      return 0;
    }

    if (command === 'build') {
      if (options.positionals.length > 0) {
        io.stderr.write(`Build does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runBuild({
        workspaceRoot: resolvedWorkspaceRoot!,
      });
      io.stdout.write(`${formatBuildSummary(result)}\n`);
      return 0;
    }

    if (command === 'publish') {
      if (options.positionals.length > 0) {
        io.stderr.write(`Publish does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runPublish({
        workspaceRoot: resolvedWorkspaceRoot!,
      });
      io.stdout.write(`${formatPublishSummary(result)}\n`);
      return 0;
    }

    if (command === 'enable') {
      const result = await runEnable({
        workspaceRoot: resolvedWorkspaceRoot!,
        args: options.positionals,
      });
      io.stdout.write(`${formatEnableSummary(result)}\n`);
      return 0;
    }

    if (command === 'repair') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Repair does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Repair does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runRepair({
        workspaceRoot: resolvedWorkspaceRoot!,
        rawArgs: options.rawArgs,
      });
      io.stdout.write(`${formatRepairSummary(result)}\n`);
      return 0;
    }

    if (command === 'refresh') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose || options.frontendRuntime !== undefined) {
        io.stderr.write(`Refresh does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runRefresh({
        workspaceRoot: resolvedWorkspaceRoot!,
        args: options.positionals,
      });
      io.stdout.write(`${formatRefreshSummary(result)}\n`);
      return 0;
    }

    if (options.positionals.length > 0) {
      io.stderr.write(`Watch does not accept positional arguments.\n\n${HELP_TEXT}`);
      return 1;
    }

    await runWatch({
      workspaceRoot: resolvedWorkspaceRoot!,
      host: options.host,
      port: options.port,
      verbose: options.verbose,
      hmrVerbose: options.hmrVerbose,
      frontendRuntime: options.frontendRuntime,
      io,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`[webstir] ${command} failed: ${message}\n`);
    return 1;
  }
}

interface ParsedCommandOptions {
  readonly workspaceRoot?: string;
  readonly host?: string;
  readonly port?: number;
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly hmrVerbose: boolean;
  readonly frontendRuntime?: FrontendWatchRuntime;
  readonly positionals: readonly string[];
  readonly rawArgs: readonly string[];
  readonly help: boolean;
  readonly error?: string;
}

function parseCommandOptions(
  args: readonly string[],
  options: { readonly allowUnknownOptions?: boolean } = {}
): ParsedCommandOptions {
  let workspaceRoot: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let dryRun = false;
  let verbose = false;
  let hmrVerbose = false;
  let frontendRuntime: FrontendWatchRuntime | undefined;
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    if (arg === '--workspace' || arg === '-w') {
      const next = args[index + 1];
      if (!next || next.startsWith('-')) {
        return {
          workspaceRoot,
          host,
          port,
          dryRun,
          verbose,
          hmrVerbose,
          frontendRuntime,
          positionals,
          rawArgs: args,
          help: false,
          error: 'Missing value for --workspace.',
        };
      }

      workspaceRoot = next;
      index += 1;
      continue;
    }

    if (arg === '--host') {
      const next = args[index + 1];
      if (!next || next.startsWith('-')) {
        return {
          workspaceRoot,
          host,
          port,
          dryRun,
          verbose,
          hmrVerbose,
          frontendRuntime,
          positionals,
          rawArgs: args,
          help: false,
          error: 'Missing value for --host.',
        };
      }

      host = next;
      index += 1;
      continue;
    }

    if (arg === '--port') {
      const rawPort = args[index + 1];
      const parsedPort = Number.parseInt(rawPort ?? '', 10);
      if (!Number.isFinite(parsedPort) || parsedPort < 0) {
        return {
          workspaceRoot,
          host,
          port,
          dryRun,
          verbose,
          hmrVerbose,
          frontendRuntime,
          positionals,
          rawArgs: args,
          help: false,
          error: `Invalid --port value "${rawPort ?? ''}".`,
        };
      }

      port = parsedPort;
      index += 1;
      continue;
    }

    if (arg === '--runtime' || arg === '-r') {
      const next = args[index + 1];
      if (!next || next.startsWith('-')) {
        return {
          workspaceRoot,
          host,
          port,
          dryRun,
          verbose,
          hmrVerbose,
          frontendRuntime,
          positionals,
          rawArgs: args,
          help: false,
          error: 'Missing value for --runtime.',
        };
      }

      index += 1;
      continue;
    }

    if (arg.startsWith('--runtime=')) {
      continue;
    }

    if (arg === '--frontend-runtime') {
      const next = args[index + 1];
      if (!next || next.startsWith('-')) {
        return {
          workspaceRoot,
          host,
          port,
          dryRun,
          verbose,
          hmrVerbose,
          frontendRuntime,
          positionals,
          rawArgs: args,
          help: false,
          error: 'Missing value for --frontend-runtime.',
        };
      }

      if (next !== 'legacy' && next !== 'bun') {
        return {
          workspaceRoot,
          host,
          port,
          dryRun,
          verbose,
          hmrVerbose,
          frontendRuntime,
          positionals,
          rawArgs: args,
          help: false,
          error: `Invalid --frontend-runtime value "${next}".`,
        };
      }

      frontendRuntime = next;
      index += 1;
      continue;
    }

    if (arg.startsWith('--frontend-runtime=')) {
      const rawRuntime = arg.slice('--frontend-runtime='.length);
      if (rawRuntime !== 'legacy' && rawRuntime !== 'bun') {
        return {
          workspaceRoot,
          host,
          port,
          dryRun,
          verbose,
          hmrVerbose,
          frontendRuntime,
          positionals,
          rawArgs: args,
          help: false,
          error: `Invalid --frontend-runtime value "${rawRuntime}".`,
        };
      }

      frontendRuntime = rawRuntime;
      continue;
    }

    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
      continue;
    }

    if (arg === '--hmr-verbose') {
      hmrVerbose = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      return {
        workspaceRoot,
        host,
        port,
        dryRun,
        verbose,
        hmrVerbose,
        frontendRuntime,
        positionals,
        rawArgs: args,
        help: true,
      };
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (options.allowUnknownOptions) {
      continue;
    }

    return {
      workspaceRoot,
      host,
      port,
      dryRun,
      verbose,
      hmrVerbose,
      frontendRuntime,
      positionals,
      rawArgs: args,
      help: false,
      error: `Unknown option "${arg}".`,
    };
  }

  return {
    workspaceRoot,
    host,
    port,
    dryRun,
    verbose,
    hmrVerbose,
    frontendRuntime,
    positionals,
    rawArgs: args,
    help: false,
  };
}

const defaultIo: CliIo = {
  stdout: {
    write(message) {
      process.stdout.write(message);
    },
  },
  stderr: {
    write(message) {
      process.stderr.write(message);
    },
  },
};

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2));
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolveRealpath(process.argv[1]) === resolveRealpath(currentFile)) {
  await main();
}

function resolveRealpath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}
