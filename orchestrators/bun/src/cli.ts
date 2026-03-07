#!/usr/bin/env bun

import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { formatBuildSummary } from './format.ts';
import { runBuild } from './build.ts';
import { runWatch } from './watch.ts';

interface CliStream {
  write(message: string): void;
}

interface CliIo {
  readonly stdout: CliStream;
  readonly stderr: CliStream;
}

const HELP_TEXT = `Usage:
  webstir-bun build --workspace <path>
  webstir-bun watch --workspace <path> [--host <host>] [--port <port>]

Commands:
  build      Build a Webstir workspace with the Bun orchestrator.
  watch      Run the Bun SPA dev loop for a Webstir workspace.

Options:
  -w, --workspace <path>   Workspace root to build.
  --host <host>            Dev server host (default: 127.0.0.1).
  --port <port>            Dev server port (default: 8088).
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
  if (command !== 'build' && command !== 'watch') {
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
  if (!workspaceRoot) {
    io.stderr.write(`Missing required --workspace <path>.\n\n${HELP_TEXT}`);
    return 1;
  }

  try {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    if (command === 'build') {
      const result = await runBuild({
        workspaceRoot: resolvedWorkspaceRoot,
      });
      io.stdout.write(`${formatBuildSummary(result)}\n`);
      return 0;
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
  readonly help: boolean;
  readonly error?: string;
}

function parseCommandOptions(args: readonly string[]): ParsedCommandOptions {
  let workspaceRoot: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let verbose = false;
  let hmrVerbose = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--workspace' || arg === '-w') {
      workspaceRoot = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--host') {
      host = args[index + 1];
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
        help: true,
      };
    }

    return {
      workspaceRoot,
      host,
      port,
      verbose,
      hmrVerbose,
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
