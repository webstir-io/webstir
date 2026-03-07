#!/usr/bin/env bun

import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { formatBuildSummary } from './format.ts';
import { runBuild } from './build.ts';

interface CliStream {
  write(message: string): void;
}

interface CliIo {
  readonly stdout: CliStream;
  readonly stderr: CliStream;
}

const HELP_TEXT = `Usage:
  webstir-bun build --workspace <path>

Commands:
  build      Build a Webstir workspace with the Bun orchestrator.

Options:
  -w, --workspace <path>   Workspace root to build.
  -h, --help               Show this help text.
`;

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  const [command, ...rest] = argv;

  if (command !== 'build') {
    io.stderr.write(`Unknown command "${command}".\n\n${HELP_TEXT}`);
    return 1;
  }

  const workspaceRoot = parseWorkspaceArgument(rest);
  if (!workspaceRoot) {
    io.stderr.write(`Missing required --workspace <path>.\n\n${HELP_TEXT}`);
    return 1;
  }

  try {
    const result = await runBuild({
      workspaceRoot: path.resolve(workspaceRoot),
    });
    io.stdout.write(`${formatBuildSummary(result)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr.write(`[webstir-bun] build failed: ${message}\n`);
    return 1;
  }
}

function parseWorkspaceArgument(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--workspace' || arg === '-w') {
      return args[index + 1];
    }
  }

  return undefined;
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
