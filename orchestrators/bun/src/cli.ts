#!/usr/bin/env bun

import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assetsRoot } from './paths.ts';

import {
  formatAddSummary,
  formatAgentJson,
  formatAgentSummary,
  formatBackendInspectJson,
  formatBackendInspectSummary,
  formatBuildSummary,
  formatDoctorJson,
  formatDoctorSummary,
  formatEnableSummary,
  formatFrontendInspectJson,
  formatFrontendInspectSummary,
  formatInitSummary,
  formatInspectJson,
  formatInspectSummary,
  formatOperationsJson,
  formatOperationsSummary,
  formatPublishSummary,
  formatRepairJson,
  formatRepairSummary,
  formatRefreshSummary,
  formatSmokeSummary,
  formatTestSummary,
} from './format.ts';

interface CliStream {
  write(message: string): void;
}

interface CliIo {
  readonly stdout: CliStream;
  readonly stderr: CliStream;
}

const HELP_TEXT = `Usage:
  webstir init <starter> <directory>
  webstir init <directory>
  webstir add-page <name> --workspace <path> [--no-script]
  webstir add-island <name> --workspace <path> [--react|--preact|--solid|--svelte|--vue]
  webstir add-test <name-or-path> --workspace <path>
  webstir add-route <name> --workspace <path> [--method <METHOD>] [--path <path>] [--interaction <navigation|mutation>] [--session <optional|required>] [--session-write] [--form-urlencoded] [--csrf] [--fragment-target <target>] [--fragment-selector <selector>] [--fragment-mode <replace|append|prepend>]
  webstir add-job <name> --workspace <path> [--schedule <expression>]
  webstir add-migration <name> --workspace <path> [--ts]
  webstir migrate --workspace <path> [--status]
  webstir snapshot --workspace <path>
  webstir jobs --workspace <path>
  webstir jobs run <name> --workspace <path> [--payload <json>]
  webstir operations
  webstir mcp
  webstir agent <inspect|validate|repair|scaffold-page|scaffold-route|scaffold-job> [...]
  webstir agent repair --workspace <path> [--restore-scaffold]
  webstir inspect --workspace <path>
  webstir frontend-inspect --workspace <path>
  webstir backend-inspect --workspace <path>
  webstir doctor --workspace <path>
  webstir test --workspace <path> [--runtime <frontend|backend|all>]
  webstir smoke [--workspace <path>]
  webstir build --workspace <path>
  webstir publish --workspace <path>
  webstir enable <feature> [feature-args...] --workspace <path>
  webstir repair --workspace <path> [--dry-run] [--restore-scaffold]
  webstir refresh <starter> --workspace <path>
  webstir watch --workspace <path> [--host <host>] [--port <port>]

Commands:
  init       Scaffold a new Webstir workspace.
  add-page   Scaffold a frontend page in an existing workspace.
  add-island Scaffold an island: a component from React, Preact, Solid, Svelte, Vue, or none.
  add-test   Scaffold a test file in an existing workspace.
  add-route  Scaffold a backend route in an existing workspace.
  add-job    Scaffold a backend job in an existing workspace.
  add-migration  Write the next database migration in src/backend/migrations.
  migrate    Apply the app's pending migrations, or list them with --status.
  jobs       List the app's jobs and queue, or run one now.
  operations  List the stable Webstir framework operations.
  mcp        Run the Webstir MCP server over stdio.
  agent      Orchestrate stable Webstir operations for a narrow goal.
  inspect    Diagnose and surface stable frontend and backend contract data.
  frontend-inspect  Inspect stable frontend workspace facts for an existing workspace.
  backend-inspect  Inspect the backend manifest for an existing workspace.
  doctor     Diagnose scaffold drift and backend health for an existing workspace.
  test       Build and run workspace tests with the Bun orchestrator.
  smoke      Run an end-to-end Bun orchestrator verification flow.
  build      Build a Webstir workspace with the Bun orchestrator.
  publish    Publish a Webstir workspace with the Bun orchestrator.
  enable     Scaffold an optional Webstir feature into a workspace.
  repair     Migrate a workspace to what this Webstir version expects; never re-creates removed files.
  refresh    Reset and re-scaffold an existing valid Webstir workspace.
  watch      Run the Bun dev loop for a supported Webstir workspace.

Options:
  -w, --workspace <path>   Workspace root to operate on.
  --host <host>            Dev host or bind address (default: 127.0.0.1).
  --port <port>            Dev port (8088 for pages, 4321 for a server alone).
  --dry-run                Report repair changes without writing files.
  --restore-scaffold       With repair: also re-create missing scaffold files for the mode.
  --json                   Emit machine-readable JSON for supported commands.
  -v, --verbose            Enable verbose frontend watch diagnostics.
  -h, --help               Show this help text.

Installed app guidance:
  Recipes and coding-agent setup: ${path.join(assetsRoot, 'guides', 'README.md')}
  Starter app instructions: ${path.join(assetsRoot, 'templates', 'shared', 'AGENTS.md')}
`;

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  const [command, ...rest] = argv;
  if (
    command !== 'init' &&
    command !== 'add-page' &&
    command !== 'add-island' &&
    command !== 'add-test' &&
    command !== 'add-route' &&
    command !== 'add-job' &&
    command !== 'add-migration' &&
    command !== 'migrate' &&
    command !== 'snapshot' &&
    command !== 'jobs' &&
    command !== 'operations' &&
    command !== 'mcp' &&
    command !== 'agent' &&
    command !== 'inspect' &&
    command !== 'frontend-inspect' &&
    command !== 'backend-inspect' &&
    command !== 'doctor' &&
    command !== 'test' &&
    command !== 'smoke' &&
    command !== 'build' &&
    command !== 'publish' &&
    command !== 'enable' &&
    command !== 'repair' &&
    command !== 'refresh' &&
    command !== 'watch'
  ) {
    io.stderr.write(`Unknown command "${command}".\n\n${HELP_TEXT}`);
    return 1;
  }

  const options = parseCommandOptions(rest, {
    allowUnknownOptions:
      command === 'add-route' ||
      command === 'add-job' ||
      command === 'agent' ||
      command === 'add-island' ||
      command === 'add-migration' ||
      command === 'migrate' ||
      command === 'snapshot' ||
      command === 'jobs',
  });
  if (options.help) {
    io.stdout.write(HELP_TEXT);
    return 0;
  }

  if (options.error) {
    io.stderr.write(`${options.error}\n\n${HELP_TEXT}`);
    return 1;
  }

  if (options.restoreScaffold && command !== 'repair' && command !== 'agent') {
    io.stderr.write(`Only repair and agent repair accept --restore-scaffold.\n\n${HELP_TEXT}`);
    return 1;
  }

  if (command !== 'repair' && options.dryRun) {
    io.stderr.write(`Only repair accepts --dry-run.\n\n${HELP_TEXT}`);
    return 1;
  }

  if (
    options.json &&
    command !== 'operations' &&
    command !== 'agent' &&
    command !== 'inspect' &&
    command !== 'frontend-inspect' &&
    command !== 'backend-inspect' &&
    command !== 'doctor' &&
    command !== 'repair'
  ) {
    io.stderr.write(
      `Only operations, agent, inspect, frontend-inspect, backend-inspect, doctor, and repair accept --json.\n\n${HELP_TEXT}`,
    );
    return 1;
  }

  if (options.rawArgs.includes('--no-script') && command !== 'add-page') {
    io.stderr.write(`Only add-page accepts --no-script.\n\n${HELP_TEXT}`);
    return 1;
  }

  const workspaceRoot = options.workspaceRoot;
  if (
    command !== 'init' &&
    command !== 'smoke' &&
    command !== 'operations' &&
    command !== 'mcp' &&
    !workspaceRoot
  ) {
    io.stderr.write(`Missing required --workspace <path>.\n\n${HELP_TEXT}`);
    return 1;
  }

  try {
    if (command === 'init') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Init does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runInit } = await import('./init.ts');
      const result = await runInit({
        args: options.positionals,
        workspaceRoot,
      });
      io.stdout.write(`${formatInitSummary(result)}\n`);
      io.stdout.write(`Read app instructions: ${path.join(result.workspaceRoot, 'AGENTS.md')}\n`);
      io.stdout.write(
        `Installed recipes and setup: ${path.join(assetsRoot, 'guides', 'README.md')}\n`,
      );
      return 0;
    }

    const resolvedWorkspaceRoot = workspaceRoot ? path.resolve(workspaceRoot) : undefined;
    const requireWorkspaceRoot = (): string => {
      if (!resolvedWorkspaceRoot) {
        throw new Error('Missing required --workspace <path>.');
      }

      return resolvedWorkspaceRoot;
    };
    if (command === 'operations') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Operations does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Operations does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { listOperations } = await import('./operations.ts');
      const operations = listOperations();
      io.stdout.write(
        `${options.json ? formatOperationsJson(operations) : formatOperationsSummary(operations)}\n`,
      );
      return 0;
    }

    if (command === 'mcp') {
      if (
        options.host ||
        options.port !== undefined ||
        options.verbose ||
        options.positionals.length > 0 ||
        options.workspaceRoot ||
        options.json
      ) {
        io.stderr.write(`MCP does not accept CLI options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runMcpServer } = await import('./mcp/server.ts');
      await runMcpServer();
      return 0;
    }
    if (command === 'add-island') {
      const unknown = options.rawArgs.filter(
        (arg) =>
          arg.startsWith('-') &&
          !['--react', '--preact', '--solid', '--svelte', '--vue', '--workspace', '-w'].includes(
            arg,
          ),
      );
      if (unknown.length > 0) {
        io.stderr.write(`Unknown option "${unknown[0]}".\n\n${HELP_TEXT}`);
        return 1;
      }
      const { runAddIsland } = await import('./add-island.ts');
      const result = await runAddIsland({
        workspaceRoot: requireWorkspaceRoot(),
        args: options.positionals,
        rawArgs: options.rawArgs,
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-island complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`,
      );
      return 0;
    }

    if (command === 'add-page') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Add-page does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runAddPageCommand } = await import('./add.ts');
      const result = await runAddPageCommand({
        workspaceRoot: requireWorkspaceRoot(),
        args: options.positionals,
        noScript: options.rawArgs.includes('--no-script'),
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-page complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`,
      );
      return 0;
    }

    if (command === 'add-test') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Add-test does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runAddTestCommand } = await import('./add.ts');
      const result = await runAddTestCommand({
        workspaceRoot: requireWorkspaceRoot(),
        args: options.positionals,
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-test complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`,
      );
      return 0;
    }

    if (command === 'add-route') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Add-route does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runAddRouteCommand } = await import('./add-backend.ts');
      const result = await runAddRouteCommand({
        workspaceRoot: requireWorkspaceRoot(),
        rawArgs: options.rawArgs,
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-route complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`,
      );
      return 0;
    }

    if (command === 'add-job') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Add-job does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runAddJobCommand } = await import('./add-backend.ts');
      const result = await runAddJobCommand({
        workspaceRoot: requireWorkspaceRoot(),
        rawArgs: options.rawArgs,
      });
      io.stdout.write(
        `${formatAddSummary('[webstir] add-job complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`,
      );
      return 0;
    }

    if (
      command === 'add-migration' ||
      command === 'migrate' ||
      command === 'snapshot' ||
      command === 'jobs'
    ) {
      const allowed: Record<string, readonly string[]> = {
        'add-migration': ['--ts'],
        migrate: ['--status'],
        snapshot: [],
        jobs: ['--payload'],
      };
      const payloadAt = options.rawArgs.indexOf('--payload');
      const unknown = options.rawArgs.filter(
        (arg, index) =>
          arg.startsWith('-') &&
          !['--workspace', '-w', ...(allowed[command] ?? [])].includes(arg) &&
          !(payloadAt !== -1 && index === payloadAt + 1),
      );
      if (unknown.length > 0) {
        io.stderr.write(`Unknown option "${unknown[0]}".\n\n${HELP_TEXT}`);
        return 1;
      }
      if (command === 'add-migration') {
        const { runAddMigration } = await import('./add-migration.ts');
        const result = await runAddMigration({
          workspaceRoot: requireWorkspaceRoot(),
          args: options.positionals,
          rawArgs: options.rawArgs,
        });
        io.stdout.write(
          `${formatAddSummary('[webstir] add-migration complete', result.target, result.workspaceRoot, result.changes, result.note)}\n`,
        );
        return 0;
      }
      if (command === 'migrate') {
        const { formatMigrateResult, runMigrate } = await import('./migrate.ts');
        const result = await withSuppressedStdout(() =>
          runMigrate({
            workspaceRoot: requireWorkspaceRoot(),
            status: options.rawArgs.includes('--status'),
          }),
        );
        io.stdout.write(`${formatMigrateResult(result)}\n`);
        return 0;
      }
      if (command === 'snapshot') {
        const { runSnapshot } = await import('./migrate.ts');
        const result = await withSuppressedStdout(() =>
          runSnapshot({ workspaceRoot: requireWorkspaceRoot() }),
        );
        io.stdout.write(`[webstir] snapshot taken: ${result.key}\n`);
        return 0;
      }
      const payloadIndex = options.rawArgs.indexOf('--payload');
      const payload = payloadIndex === -1 ? undefined : options.rawArgs[payloadIndex + 1];
      const { formatJobsResult, runJobsCommand } = await import('./jobs-command.ts');
      const result = await runJobsCommand({
        workspaceRoot: requireWorkspaceRoot(),
        args: options.positionals.filter((arg) => arg !== payload),
        payload,
      });
      io.stdout.write(`${formatJobsResult(result)}\n`);
      return 0;
    }

    if (command === 'backend-inspect') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Backend-inspect does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Backend-inspect does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runBackendInspect } = await import('./backend-inspect.ts');
      const result = options.json
        ? await withSuppressedStdout(() =>
            runBackendInspect({
              workspaceRoot: requireWorkspaceRoot(),
            }),
          )
        : await runBackendInspect({
            workspaceRoot: requireWorkspaceRoot(),
          });
      io.stdout.write(
        `${options.json ? formatBackendInspectJson(result) : formatBackendInspectSummary(result)}\n`,
      );
      return 0;
    }

    if (command === 'frontend-inspect') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Frontend-inspect does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Frontend-inspect does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runFrontendInspect } = await import('./frontend-inspect.ts');
      const result = await runFrontendInspect({
        workspaceRoot: requireWorkspaceRoot(),
      });
      io.stdout.write(
        `${options.json ? formatFrontendInspectJson(result) : formatFrontendInspectSummary(result)}\n`,
      );
      return 0;
    }

    if (command === 'doctor') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Doctor does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Doctor does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runDoctor } = await import('./doctor.ts');
      const result = await withSuppressedStdout(() =>
        runDoctor({
          workspaceRoot: requireWorkspaceRoot(),
        }),
      );
      io.stdout.write(`${options.json ? formatDoctorJson(result) : formatDoctorSummary(result)}\n`);
      return result.healthy ? 0 : 1;
    }

    if (command === 'inspect') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Inspect does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Inspect does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runInspect } = await import('./inspect.ts');
      const result = await withSuppressedStdout(() =>
        runInspect({
          workspaceRoot: requireWorkspaceRoot(),
        }),
      );
      io.stdout.write(
        `${options.json ? formatInspectJson(result) : formatInspectSummary(result)}\n`,
      );
      return result.success ? 0 : 1;
    }

    if (command === 'agent') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Agent does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const goal = options.positionals[0];
      if (
        goal !== 'inspect' &&
        goal !== 'validate' &&
        goal !== 'repair' &&
        goal !== 'scaffold-page' &&
        goal !== 'scaffold-route' &&
        goal !== 'scaffold-job'
      ) {
        io.stderr.write(
          `Agent requires one of: inspect, validate, repair, scaffold-page, scaffold-route, scaffold-job.\n\n${HELP_TEXT}`,
        );
        return 1;
      }

      if (options.restoreScaffold && goal !== 'repair') {
        io.stderr.write(`Only agent repair accepts --restore-scaffold.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runAgent } = await import('./agent.ts');
      const result = await withSuppressedStdout(() =>
        runAgent({
          workspaceRoot: requireWorkspaceRoot(),
          goal,
          rawArgs: options.rawArgs,
          positionals: options.positionals,
        }),
      );
      io.stdout.write(`${options.json ? formatAgentJson(result) : formatAgentSummary(result)}\n`);
      return result.success ? 0 : 1;
    }

    if (command === 'test') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Test does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runTest } = await import('./test.ts');
      const result = await runTest({
        workspaceRoot: requireWorkspaceRoot(),
        rawArgs: options.rawArgs,
      });
      io.stdout.write(`${formatTestSummary(result)}\n`);
      return result.hadFailures ? 1 : 0;
    }

    if (command === 'smoke') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Smoke does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Smoke does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runSmoke } = await import('./smoke.ts');
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

      const { runBuild } = await import('./build.ts');
      const result = await runBuild({
        workspaceRoot: requireWorkspaceRoot(),
      });
      io.stdout.write(`${formatBuildSummary(result)}\n`);
      return 0;
    }

    if (command === 'publish') {
      if (options.positionals.length > 0) {
        io.stderr.write(`Publish does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runPublish } = await import('./publish.ts');
      const result = await runPublish({
        workspaceRoot: requireWorkspaceRoot(),
      });
      io.stdout.write(`${formatPublishSummary(result)}\n`);
      return 0;
    }

    if (command === 'enable') {
      const { runEnable } = await import('./enable.ts');
      const result = await runEnable({
        workspaceRoot: requireWorkspaceRoot(),
        args: options.positionals,
      });
      io.stdout.write(`${formatEnableSummary(result)}\n`);
      return 0;
    }

    if (command === 'repair') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Repair does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      if (options.positionals.length > 0) {
        io.stderr.write(`Repair does not accept positional arguments.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runRepair } = await import('./repair.ts');
      const result = await runRepair({
        workspaceRoot: requireWorkspaceRoot(),
        rawArgs: options.rawArgs,
      });
      io.stdout.write(`${options.json ? formatRepairJson(result) : formatRepairSummary(result)}\n`);
      return 0;
    }

    if (command === 'refresh') {
      if (options.host || options.port !== undefined || options.verbose) {
        io.stderr.write(`Refresh does not accept watch options.\n\n${HELP_TEXT}`);
        return 1;
      }

      const { runRefresh } = await import('./refresh.ts');
      const result = await runRefresh({
        workspaceRoot: requireWorkspaceRoot(),
        args: options.positionals,
      });
      io.stdout.write(`${formatRefreshSummary(result)}\n`);
      return 0;
    }

    if (options.positionals.length > 0) {
      io.stderr.write(`Watch does not accept positional arguments.\n\n${HELP_TEXT}`);
      return 1;
    }

    const { runWatch } = await import('./watch.ts');
    await runWatch({
      workspaceRoot: requireWorkspaceRoot(),
      host: options.host,
      port: options.port,
      verbose: options.verbose,
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
  readonly restoreScaffold?: boolean;
  readonly json: boolean;
  readonly verbose: boolean;
  readonly positionals: readonly string[];
  readonly rawArgs: readonly string[];
  readonly help: boolean;
  readonly error?: string;
}

function parseCommandOptions(
  args: readonly string[],
  options: { readonly allowUnknownOptions?: boolean } = {},
): ParsedCommandOptions {
  let workspaceRoot: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let dryRun = false;
  let restoreScaffold = false;
  let json = false;
  let verbose = false;
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
          json,
          verbose,
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
          json,
          verbose,
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
          json,
          verbose,
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
          json,
          verbose,
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

    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
      continue;
    }

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      return {
        workspaceRoot,
        host,
        port,
        dryRun,
        json,
        verbose,
        positionals,
        rawArgs: args,
        help: true,
      };
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    // add-page reads it from the raw arguments.
    if (arg === '--no-script') {
      continue;
    }

    if (arg === '--restore-scaffold') {
      restoreScaffold = true;
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
      json,
      verbose,
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
    restoreScaffold,
    json,
    verbose,
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

async function withSuppressedStdout<T>(callback: () => Promise<T>): Promise<T> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  const originalInfo = console.info;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  console.log = (() => undefined) as typeof console.log;
  console.info = (() => undefined) as typeof console.info;

  try {
    return await callback();
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
    console.info = originalInfo;
  }
}
