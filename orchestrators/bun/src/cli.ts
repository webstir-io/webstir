#!/usr/bin/env bun

import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runEnable } from './enable.ts';
import { formatBuildSummary, formatEnableSummary, formatInitSummary, formatPublishSummary, formatRefreshSummary } from './format.ts';
import { runInit } from './init.ts';
import { runRefresh } from './refresh.ts';
import { runBuild } from './build.ts';
import { runPublish } from './publish.ts';
import { runWatch } from './watch.ts';

interface CliStream {
  write(message: string): void;
}

interface CliIo {
  readonly stdout: CliStream;
  readonly stderr: CliStream;
}

const HELP_TEXT = `Usage:
  webstir-bun init <mode> <directory>
  webstir-bun init <directory>
  webstir-bun build --workspace <path>
  webstir-bun publish --workspace <path>
  webstir-bun enable <feature> [feature-args...] --workspace <path>
  webstir-bun refresh <mode> --workspace <path>
  webstir-bun watch --workspace <path> [--host <host>] [--port <port>]

Commands:
  init       Scaffold a new Webstir workspace.
  build      Build a Webstir workspace with the Bun orchestrator.
  publish    Publish a Webstir workspace with the Bun orchestrator.
  enable     Scaffold an optional Webstir feature into a workspace.
  refresh    Reset and re-scaffold an existing workspace directory.
  watch      Run the Bun dev loop for a supported Webstir workspace.

Options:
  -w, --workspace <path>   Workspace root to operate on.
  --host <host>            Dev host or bind address (default: 127.0.0.1).
  --port <port>            Dev port (SPA default: 8088, API default: 4321).
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
  if (command !== 'init' && command !== 'build' && command !== 'publish' && command !== 'enable' && command !== 'refresh' && command !== 'watch') {
    io.stderr.write(`Unknown command "${command}".\n\n${HELP_TEXT}`);
    return 1;
  }

  const options = parseCommandOptions(rest);
  if (options.help) {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  if (options.error) {
    io.stderr.write(`${options.error}\n\n${HELP_TEXT}`);
    return 1;
  }

  const workspaceRoot = options.workspaceRoot;
  if (command !== 'init' && !workspaceRoot) {
    io.stderr.write(`Missing required --workspace <path>.\n\n${HELP_TEXT}`);
    return 1;
  }

  try {
    if (command === 'init') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose) {
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

    const resolvedWorkspaceRoot = path.resolve(workspaceRoot!);
    if (command === 'build') {
      if (options.positionals.length > 0) {
        io.stderr.write(`Build does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runBuild({
        workspaceRoot: resolvedWorkspaceRoot,
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
        workspaceRoot: resolvedWorkspaceRoot,
      });
      io.stdout.write(`${formatPublishSummary(result)}\n`);
      return 0;
    }

    if (command === 'enable') {
      const result = await runEnable({
        workspaceRoot: resolvedWorkspaceRoot,
        args: options.positionals,
      });
      io.stdout.write(`${formatEnableSummary(result)}\n`);
      return 0;
    }

    if (command === 'refresh') {
      if (options.host || options.port !== undefined || options.verbose || options.hmrVerbose) {
        io.stderr.write(`Refresh does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const result = await runRefresh({
        workspaceRoot: resolvedWorkspaceRoot,
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
      workspaceRoot: resolvedWorkspaceRoot,
      host: options.host,
      port: options.port,
      verbose: options.verbose,
      hmrVerbose: options.hmrVerbose,
      io,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`[webstir-bun] ${command} failed: ${message}\n`);
    return 1;
  }
}

interface ParsedCommandOptions {
  readonly workspaceRoot?: string;
  readonly host?: string;
  readonly port?: number;
  readonly verbose: boolean;
  readonly hmrVerbose: boolean;
  readonly positionals: readonly string[];
  readonly help: boolean;
  readonly error?: string;
}

function parseCommandOptions(args: readonly string[]): ParsedCommandOptions {
  let workspaceRoot: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let verbose = false;
  let hmrVerbose = false;
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
          verbose,
          hmrVerbose,
          positionals,
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
          verbose,
          hmrVerbose,
          positionals,
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
          verbose,
          hmrVerbose,
          positionals,
          help: false,
          error: `Invalid --port value "${rawPort ?? ''}".`,
        };
      }

      port = parsedPort;
      index += 1;
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
        verbose,
        hmrVerbose,
        positionals,
        help: true,
      };
    }

    return {
      workspaceRoot,
      host,
      port,
      verbose,
      hmrVerbose,
      positionals,
      help: false,
      error: `Unknown option "${arg}".`,
    };
  }

  return {
    workspaceRoot,
    host,
    port,
    verbose,
    hmrVerbose,
    positionals,
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
