#!/usr/bin/env bun

import path from 'node:path';

import { startPublishedWorkspaceServer } from './runtime/deploy.js';

async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const workspaceRoot = path.resolve(args.workspace ?? process.cwd());
  const server = await startPublishedWorkspaceServer({
    workspaceRoot,
    host: args.host,
    port: args.port,
  });

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    process.stderr.write(`[webstir-backend-deploy] received ${signal}, stopping.\n`);
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.stdout.write(
    `[webstir-backend-deploy] serving ${server.mode} workspace at ${server.origin}\n`,
  );

  await new Promise<void>(() => {
    // Keep the process alive until it receives a signal.
  });
}

function parseArgs(argv: readonly string[]): {
  readonly workspace?: string;
  readonly host?: string;
  readonly port?: number;
  readonly help: boolean;
} {
  let workspace: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--workspace') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --workspace.');
      }
      workspace = next;
      index += 1;
      continue;
    }

    if (arg === '--host') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --host.');
      }
      host = next;
      index += 1;
      continue;
    }

    if (arg === '--port') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --port.');
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for --port: ${next}`);
      }
      port = parsed;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { workspace, host, port, help };
}

function printHelp(): void {
  process.stdout.write(`Usage: webstir-backend-deploy [--workspace <path>] [--host <host>] [--port <port>]

Starts a published api or full Webstir workspace with a single Bun entrypoint.
`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
