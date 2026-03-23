import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { glob } from 'glob';

import type { ModuleDiagnostic } from '@webstir-io/module-contract';

import {
  ensureModuleDefinitionBuild,
  formatEsbuildMessage,
  shouldTypeCheck,
} from './build/pipeline.js';
import { discoverEntryPoints } from './build/entries.js';
import { loadBackendModuleManifest } from './manifest/pipeline.js';
import { createCacheReporter } from './cache/reporters.js';
import { normalizeMode, resolveWorkspacePaths, resolveWorkspaceRoot } from './workspace.js';

export interface WatchHandle {
  stop(): Promise<void>;
}

export interface BackendWatchEvent {
  readonly type: 'build-start' | 'build-complete';
  readonly succeeded?: boolean;
  readonly errorCount?: number;
  readonly warningCount?: number;
  readonly durationMs?: number;
  readonly bunBenchmarkSucceeded?: boolean;
  readonly bunBenchmarkErrorCount?: number;
  readonly bunBenchmarkWarningCount?: number;
  readonly bunBenchmarkDurationMs?: number;
}

export interface StartWatchOptions {
  readonly workspaceRoot?: string;
  readonly env?: Record<string, string | undefined>;
  readonly onEvent?: (event: BackendWatchEvent) => void | Promise<void>;
}

interface BunBuildOutputFile {
  readonly path: string;
  readonly size?: number;
}

interface BunBuildLog {
  readonly level?: string;
  readonly message?: string;
  readonly text?: string;
  readonly position?: {
    readonly file?: string;
    readonly line?: number;
    readonly column?: number;
  } | null;
}

interface BunBuildOutput {
  readonly success: boolean;
  readonly outputs?: readonly BunBuildOutputFile[];
  readonly logs?: readonly BunBuildLog[];
}

type BunBuildFunction = (config: Record<string, unknown>) => Promise<BunBuildOutput>;

interface WatchBuildResult {
  readonly succeeded: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
}

const WATCH_POLL_INTERVAL_MS = 250;

export async function startBackendWatch(options: StartWatchOptions): Promise<WatchHandle> {
  const env = { ...process.env, ...(options.env ?? {}) };
  const workspaceRoot = resolveWorkspaceRoot({
    workspaceRoot: options.workspaceRoot,
    env,
  });
  const paths = resolveWorkspacePaths(workspaceRoot);
  const tsconfigPath = path.join(paths.sourceRoot, 'tsconfig.json');
  const mode = normalizeMode(env.WEBSTIR_MODULE_MODE);

  const initialEntryPoints = await discoverEntryPoints(paths.sourceRoot);
  if (initialEntryPoints.length === 0) {
    console.warn(`[webstir-backend] watch: no entry found under ${paths.sourceRoot} (index.ts/js)`);
    throw new Error('No backend entry point found.');
  }

  const nodeEnv = env.NODE_ENV ?? (mode === 'publish' ? 'production' : 'development');
  const shouldReportBunBenchmark = isEnabled(env.WEBSTIR_BACKEND_WATCH_BUN_BENCHMARK);
  const diagMax = (() => {
    const raw = env.WEBSTIR_BACKEND_DIAG_MAX;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 20;
  })();

  console.info(`[webstir-backend] watch:start (${mode})`);

  let tscProc: ChildProcess | undefined;
  if (shouldTypeCheck(mode, env)) {
    const tscArgs = ['-p', tsconfigPath, '--noEmit', '--watch'];
    tscProc = spawn('tsc', tscArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env, NODE_ENV: nodeEnv },
      cwd: workspaceRoot,
    });

    tscProc.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line) console.info(`[webstir-backend][tsc] ${line}`);
      }
    });
    tscProc.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line) console.warn(`[webstir-backend][tsc] ${line}`);
      }
    });
  } else {
    console.info('[webstir-backend] watch: type-check skipped by WEBSTIR_BACKEND_TYPECHECK');
  }

  if (shouldReportBunBenchmark) {
    console.info(
      '[webstir-backend] watch: reporting primary Bun build timings via bunBenchmark* event fields.',
    );
  }

  let stopping = false;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  let currentSnapshot = await takeWatchSnapshot(workspaceRoot, paths.sourceRoot, tsconfigPath);
  let buildInFlight = false;
  let pendingBuild = false;
  let buildFailure: Error | undefined;

  const runBuild = async (): Promise<void> => {
    if (stopping) {
      return;
    }

    if (buildInFlight) {
      pendingBuild = true;
      return;
    }

    buildInFlight = true;
    try {
      do {
        pendingBuild = false;
        const nextSnapshot = await takeWatchSnapshot(workspaceRoot, paths.sourceRoot, tsconfigPath);
        currentSnapshot = nextSnapshot;
        const result = await performWatchBuild({
          workspaceRoot,
          sourceRoot: paths.sourceRoot,
          buildRoot: paths.buildRoot,
          tsconfigPath,
          mode,
          env,
          nodeEnv,
          diagMax,
          shouldReportBunBenchmark,
          onEvent: options.onEvent,
        });

        if (!result.succeeded) {
          buildFailure = new Error('Backend watch build failed.');
        } else {
          buildFailure = undefined;
        }
      } while (pendingBuild && !stopping);
    } finally {
      buildInFlight = false;
    }
  };

  await runBuild();

  console.info('[webstir-backend] watch:ready');

  const poll = async (): Promise<void> => {
    if (stopping) {
      return;
    }

    try {
      const nextSnapshot = await takeWatchSnapshot(workspaceRoot, paths.sourceRoot, tsconfigPath);
      if (nextSnapshot !== currentSnapshot) {
        currentSnapshot = nextSnapshot;
        await runBuild();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[webstir-backend] watch:poll failed: ${message}`);
    } finally {
      if (!stopping) {
        watchTimer = setTimeout(() => {
          void poll();
        }, WATCH_POLL_INTERVAL_MS);
      }
    }
  };

  watchTimer = setTimeout(() => {
    void poll();
  }, WATCH_POLL_INTERVAL_MS);

  return {
    async stop() {
      stopping = true;
      if (watchTimer) {
        clearTimeout(watchTimer);
      }
      try {
        tscProc?.kill('SIGINT');
      } catch {
        // ignore
      }
      console.info('[webstir-backend] watch:stopped');

      if (buildFailure) {
        buildFailure = undefined;
      }
    },
  };
}

interface PerformWatchBuildOptions {
  readonly workspaceRoot: string;
  readonly sourceRoot: string;
  readonly buildRoot: string;
  readonly tsconfigPath: string;
  readonly mode: ReturnType<typeof normalizeMode>;
  readonly env: Record<string, string | undefined>;
  readonly nodeEnv: string;
  readonly diagMax: number;
  readonly shouldReportBunBenchmark: boolean;
  readonly onEvent?: StartWatchOptions['onEvent'];
}

async function performWatchBuild(options: PerformWatchBuildOptions): Promise<WatchBuildResult> {
  const start = performance.now();
  await emitWatchEvent(options.onEvent, {
    type: 'build-start',
  });

  const diagnostics: ModuleDiagnostic[] = [];
  const entryPoints = await discoverEntryPoints(options.sourceRoot);
  if (entryPoints.length === 0) {
    diagnostics.push({
      severity: 'error',
      message: `No backend entry points found under ${options.sourceRoot}.`,
    });
    flushDiagnostics(diagnostics);
    const end = performance.now();
    await emitWatchEvent(options.onEvent, {
      type: 'build-complete',
      succeeded: false,
      errorCount: 1,
      warningCount: 0,
      durationMs: end - start,
    });
    return {
      succeeded: false,
      errorCount: 1,
      warningCount: 0,
    };
  }

  const buildResult = await runPrimaryBunWatchBuild({
    entryPoints,
    sourceRoot: options.sourceRoot,
    buildRoot: options.buildRoot,
    tsconfigPath: options.tsconfigPath,
    nodeEnv: options.nodeEnv,
    diagMax: options.diagMax,
  });

  console.info(
    `[webstir-backend] watch:bun ${buildResult.errorCount} error(s), ${buildResult.warningCount} warning(s) in ${buildResult.durationMs.toFixed(1)}ms`,
  );

  if (buildResult.succeeded) {
    const cacheReporter = createCacheReporter({
      workspaceRoot: options.workspaceRoot,
      buildRoot: options.buildRoot,
      env: options.env,
      diagnostics,
    });

    try {
      await ensureModuleDefinitionBuild({
        sourceRoot: options.sourceRoot,
        buildRoot: options.buildRoot,
        tsconfigPath: options.tsconfigPath,
        mode: options.mode,
        env: options.env,
        diagnostics,
      });
      await cacheReporter.diffOutputs(
        collectBunOutputSizes(buildResult.outputs, options.buildRoot),
        options.mode,
      );
      const manifest = await loadBackendModuleManifest({
        workspaceRoot: options.workspaceRoot,
        buildRoot: options.buildRoot,
        entryPoints,
        diagnostics,
      });
      await cacheReporter.diffManifest(manifest);
    } catch {
      // cache or manifest diff failure should not break watch
    }
  }

  flushDiagnostics(diagnostics);
  const end = performance.now();
  const bunBenchmark = options.shouldReportBunBenchmark
    ? {
        succeeded: buildResult.succeeded,
        errorCount: buildResult.errorCount,
        warningCount: buildResult.warningCount,
        durationMs: buildResult.durationMs,
      }
    : undefined;

  await emitWatchEvent(options.onEvent, {
    type: 'build-complete',
    succeeded: buildResult.succeeded,
    errorCount: buildResult.errorCount,
    warningCount: buildResult.warningCount,
    durationMs: end - start,
    bunBenchmarkSucceeded: bunBenchmark?.succeeded,
    bunBenchmarkErrorCount: bunBenchmark?.errorCount,
    bunBenchmarkWarningCount: bunBenchmark?.warningCount,
    bunBenchmarkDurationMs: bunBenchmark?.durationMs,
  });

  return {
    succeeded: buildResult.succeeded,
    errorCount: buildResult.errorCount,
    warningCount: buildResult.warningCount,
  };
}

interface RunPrimaryBunWatchBuildOptions {
  readonly entryPoints: readonly string[];
  readonly sourceRoot: string;
  readonly buildRoot: string;
  readonly tsconfigPath: string;
  readonly nodeEnv: string;
  readonly diagMax: number;
}

interface RunPrimaryBunWatchBuildResult {
  readonly succeeded: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly durationMs: number;
  readonly outputs?: readonly BunBuildOutputFile[];
}

async function runPrimaryBunWatchBuild(
  options: RunPrimaryBunWatchBuildOptions,
): Promise<RunPrimaryBunWatchBuildResult> {
  const build = getBunBuild();
  if (!build) {
    throw new Error('Bun.build() is not available in the current runtime.');
  }

  await rm(options.buildRoot, { recursive: true, force: true });
  await mkdir(options.buildRoot, { recursive: true });

  const start = performance.now();
  const result = await build({
    entrypoints: [...options.entryPoints],
    root: options.sourceRoot,
    outdir: options.buildRoot,
    target: 'node',
    format: 'esm',
    splitting: false,
    packages: 'external',
    sourcemap: 'linked',
    tsconfig: existsSync(options.tsconfigPath) ? options.tsconfigPath : undefined,
    define: {
      'process.env.NODE_ENV': JSON.stringify(options.nodeEnv),
    },
    // Preserve the old esbuild watch behavior: transpile entries without requiring
    // every relative import target to exist in minimal seeded workspaces.
    plugins: [createRelativeImportPassthroughPlugin()],
    throw: false,
  });
  const end = performance.now();

  const { errorCount, warningCount } = logBunBuildResult(result, options.diagMax);

  return {
    succeeded: result.success && errorCount === 0,
    errorCount,
    warningCount,
    durationMs: end - start,
    outputs: result.outputs,
  };
}

function logBunBuildResult(
  result: BunBuildOutput,
  diagMax: number,
): {
  errorCount: number;
  warningCount: number;
} {
  const logs = Array.isArray(result.logs) ? result.logs : [];
  const errorLogs = logs.filter((log) => log.level === 'error');
  const warningLogs = logs.filter((log) => log.level === 'warning');

  for (const log of errorLogs.slice(0, diagMax)) {
    console.error(`[webstir-backend][bun] ${formatEsbuildMessage(log)}`);
  }
  if (errorLogs.length > diagMax) {
    console.error(`[webstir-backend][bun] ... ${errorLogs.length - diagMax} more error(s) omitted`);
  }

  for (const log of warningLogs.slice(0, diagMax)) {
    console.warn(`[webstir-backend][bun] ${formatEsbuildMessage(log)}`);
  }
  if (warningLogs.length > diagMax) {
    console.warn(
      `[webstir-backend][bun] ... ${warningLogs.length - diagMax} more warning(s) omitted`,
    );
  }

  return {
    errorCount: errorLogs.length,
    warningCount: warningLogs.length,
  };
}

function collectBunOutputSizes(
  outputs: readonly BunBuildOutputFile[] | undefined,
  buildRoot: string,
): Record<string, number> {
  const collected: Record<string, number> = {};
  for (const output of outputs ?? []) {
    const rel = path.relative(buildRoot, output.path);
    collected[rel] = typeof output.size === 'number' ? output.size : 0;
  }
  return collected;
}

async function takeWatchSnapshot(
  workspaceRoot: string,
  sourceRoot: string,
  tsconfigPath: string,
): Promise<string> {
  const watchFiles = new Set<string>();

  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  if (existsSync(packageJsonPath)) {
    watchFiles.add(packageJsonPath);
  }
  if (existsSync(tsconfigPath)) {
    watchFiles.add(tsconfigPath);
  }

  const typesRoot = path.join(workspaceRoot, 'types');
  const directoryRoots = [sourceRoot];
  if (existsSync(typesRoot)) {
    directoryRoots.push(typesRoot);
  }

  for (const directoryRoot of directoryRoots) {
    for (const filePath of await listWatchFiles(directoryRoot)) {
      watchFiles.add(filePath);
    }
  }

  const entries = await Promise.all(
    Array.from(watchFiles)
      .sort()
      .map(async (filePath) => {
        const fileStat = await stat(filePath);
        return `${filePath}:${fileStat.size}:${fileStat.mtimeMs}`;
      }),
  );

  return entries.join('|');
}

async function listWatchFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }

  const entries = await glob('**/*', {
    cwd: root,
    absolute: true,
    dot: false,
    nodir: false,
  });

  const files: string[] = [];
  for (const entry of entries) {
    try {
      const entryStat = await stat(entry);
      if (entryStat.isFile()) {
        files.push(entry);
      }
    } catch {
      // Ignore files deleted between glob and stat.
    }
  }

  return files;
}

function flushDiagnostics(diagnostics: readonly ModuleDiagnostic[]): void {
  for (const diag of diagnostics) {
    const logger =
      diag.severity === 'error'
        ? console.error
        : diag.severity === 'warn'
          ? console.warn
          : console.info;
    logger(diag.message);
  }
}

async function emitWatchEvent(
  onEvent: StartWatchOptions['onEvent'],
  event: BackendWatchEvent,
): Promise<void> {
  if (!onEvent) {
    return;
  }

  try {
    await onEvent(event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[webstir-backend] watch:event failed: ${message}`);
  }
}

function getBunBuild(): BunBuildFunction | undefined {
  const runtime = globalThis as typeof globalThis & {
    Bun?: {
      build?: BunBuildFunction;
    };
  };
  const build = runtime.Bun?.build;
  return typeof build === 'function' ? build.bind(runtime.Bun) : undefined;
}

function createRelativeImportPassthroughPlugin(): Record<string, unknown> {
  return {
    name: 'webstir-backend-watch-relative-imports',
    setup(build: {
      onResolve(
        options: { filter: RegExp },
        callback: (args: { path: string }) => { path: string; external: boolean },
      ): void;
    }) {
      build.onResolve({ filter: /^\.\.?\// }, (args: { path: string }) => ({
        path: args.path,
        external: true,
      }));
    },
  };
}

function isEnabled(value: string | undefined): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}
