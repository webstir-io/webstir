import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { context as createEsbuildContext, type BuildContext, type BuildResult, type Plugin } from 'esbuild';

import type { ModuleDiagnostic } from '@webstir-io/module-contract';

import { collectOutputSizes, formatEsbuildMessage, shouldTypeCheck } from './build/pipeline.js';
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

export async function startBackendWatch(options: StartWatchOptions): Promise<WatchHandle> {
  const env = { ...process.env, ...(options.env ?? {}) };
  const workspaceRoot = resolveWorkspaceRoot({
    workspaceRoot: options.workspaceRoot,
    env,
  });
  const paths = resolveWorkspacePaths(workspaceRoot);
  const tsconfigPath = path.join(paths.sourceRoot, 'tsconfig.json');
  const mode = normalizeMode(env.WEBSTIR_MODULE_MODE);

  const entryPoints = await discoverEntryPoints(paths.sourceRoot);
  if (entryPoints.length === 0) {
    console.warn(`[webstir-backend] watch: no entry found under ${paths.sourceRoot} (index.ts/js)`);
    throw new Error('No backend entry point found.');
  }

  const nodeEnv = env.NODE_ENV ?? (mode === 'publish' ? 'production' : 'development');
  const shouldBenchmarkBunBuild = isEnabled(env.WEBSTIR_BACKEND_WATCH_BUN_BENCHMARK);
  const diagMax = (() => {
    const raw = env.WEBSTIR_BACKEND_DIAG_MAX;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 20;
  })();

  console.info(`[webstir-backend] watch:start (${mode})`);

  // Start type-checker in watch mode (no emit) unless explicitly skipped for DX.
  const shouldRunTypecheck = shouldTypeCheck(mode, env);
  let tscProc: ChildProcess | undefined;
  if (shouldRunTypecheck) {
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

  const timingPlugin: Plugin = {
    name: 'webstir-watch-logger',
    setup(build) {
      let start = 0;
      build.onStart(async () => {
        start = performance.now();
        await emitWatchEvent(options.onEvent, {
          type: 'build-start'
        });
      });
      build.onEnd(async (result: BuildResult) => {
        const end = performance.now();
        const warnCount = result.warnings?.length ?? 0;
        // errors is not in the typed result, but present at runtime
        const errorList = (result as any).errors ?? [];
        const errorCount = Array.isArray(errorList) ? errorList.length : 0;
        // Print detailed diagnostics with file:line when available (capped for readability)
        if (errorCount > 0) {
          for (const msg of errorList.slice(0, diagMax)) {
            const text = formatEsbuildMessage(msg);
            console.error(`[webstir-backend][esbuild] ${text}`);
          }
          if (errorCount > diagMax) {
            console.error(`[webstir-backend][esbuild] ... ${errorCount - diagMax} more error(s) omitted`);
          }
        }
        if (warnCount > 0) {
          for (const msg of result.warnings.slice(0, diagMax)) {
            const text = formatEsbuildMessage(msg as any);
            console.warn(`[webstir-backend][esbuild] ${text}`);
          }
          if (warnCount > diagMax) {
            console.warn(`[webstir-backend][esbuild] ... ${warnCount - diagMax} more warning(s) omitted`);
          }
        }
        console.info(`[webstir-backend] watch:esbuild ${errorCount} error(s), ${warnCount} warning(s) in ${(end - start).toFixed(1)}ms`);

        let bunBenchmark: BunWatchBenchmarkResult | undefined;
        if (shouldBenchmarkBunBuild && errorCount === 0) {
          try {
            bunBenchmark = await runBunWatchBenchmark({
              entryPoints,
              sourceRoot: paths.sourceRoot,
              tsconfigPath,
              nodeEnv,
              diagMax,
            });
            console.info(
              `[webstir-backend] watch:bun ${bunBenchmark.errorCount} error(s), ${bunBenchmark.warningCount} warning(s) in ${bunBenchmark.durationMs.toFixed(1)}ms`
            );
            console.info(
              `[webstir-backend] watch:benchmark esbuild-incremental ${(end - start).toFixed(1)}ms vs bun-full ${bunBenchmark.durationMs.toFixed(1)}ms`
            );
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[webstir-backend] watch:bun-benchmark failed: ${message}`);
          }
        }

        if (errorCount === 0) {
          const diagBuffer: ModuleDiagnostic[] = [];
          const cacheReporter = createCacheReporter({
            workspaceRoot,
            buildRoot: paths.buildRoot,
            env,
            diagnostics: diagBuffer
          });
          try {
            const metafile: any = (result as any).metafile;
            if (metafile && metafile.outputs) {
              const outputs = collectOutputSizes(metafile, paths.buildRoot);
              await cacheReporter.diffOutputs(outputs, mode);
            }
            const manifest = await loadBackendModuleManifest({
              workspaceRoot,
              buildRoot: paths.buildRoot,
              entryPoints,
              diagnostics: diagBuffer
            });
            await cacheReporter.diffManifest(manifest);
          } catch {
            // cache or manifest diff failure should not break watch
          } finally {
            for (const diag of diagBuffer) {
              const logger =
                diag.severity === 'error' ? console.error : diag.severity === 'warn' ? console.warn : console.info;
              logger(diag.message);
            }
          }
        }

        await emitWatchEvent(options.onEvent, {
          type: 'build-complete',
          succeeded: errorCount === 0,
          errorCount,
          warningCount: warnCount,
          durationMs: end - start,
          bunBenchmarkSucceeded: bunBenchmark?.succeeded,
          bunBenchmarkErrorCount: bunBenchmark?.errorCount,
          bunBenchmarkWarningCount: bunBenchmark?.warningCount,
          bunBenchmarkDurationMs: bunBenchmark?.durationMs
        });
      });
    },
  };

  const ctx: BuildContext = await createEsbuildContext({
    entryPoints,
    bundle: false,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    sourcemap: true,
    outdir: paths.buildRoot,
    outbase: paths.sourceRoot,
    metafile: true,
    tsconfig: existsSync(tsconfigPath) ? tsconfigPath : undefined,
    define: { 'process.env.NODE_ENV': JSON.stringify(nodeEnv) },
    logLevel: 'silent',
    plugins: [timingPlugin],
  });

  await ctx.watch();

  console.info('[webstir-backend] watch:ready');

  return {
    async stop() {
      try {
        await ctx.dispose();
      } catch {
        // ignore
      }
      try {
        tscProc?.kill('SIGINT');
      } catch {
        // ignore
      }
      console.info('[webstir-backend] watch:stopped');
    },
  };
}

async function emitWatchEvent(
  onEvent: StartWatchOptions['onEvent'],
  event: BackendWatchEvent
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

interface BunWatchBenchmarkResult {
  readonly succeeded: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly durationMs: number;
}

interface RunBunWatchBenchmarkOptions {
  readonly entryPoints: readonly string[];
  readonly sourceRoot: string;
  readonly tsconfigPath: string;
  readonly nodeEnv: string;
  readonly diagMax: number;
}

async function runBunWatchBenchmark(options: RunBunWatchBenchmarkOptions): Promise<BunWatchBenchmarkResult> {
  const build = getBunBuild();
  if (!build) {
    throw new Error('Bun.build() is not available in the current runtime.');
  }

  const outdir = await mkdtemp(path.join(tmpdir(), 'webstir-backend-watch-benchmark-'));
  const start = performance.now();

  try {
    const result = await build({
      entrypoints: [...options.entryPoints],
      root: options.sourceRoot,
      outdir,
      target: 'node',
      format: 'esm',
      splitting: false,
      packages: 'external',
      sourcemap: 'linked',
      tsconfig: existsSync(options.tsconfigPath) ? options.tsconfigPath : undefined,
      define: { 'process.env.NODE_ENV': JSON.stringify(options.nodeEnv) },
      throw: false,
    });

    const end = performance.now();
    const warningLogs = (result.logs ?? []).filter((log) => log.level === 'warning');
    const errorLogs = (result.logs ?? []).filter((log) => log.level === 'error');

    for (const log of errorLogs.slice(0, options.diagMax)) {
      console.error(`[webstir-backend][bun] ${formatEsbuildMessage(log)}`);
    }
    if (errorLogs.length > options.diagMax) {
      console.error(`[webstir-backend][bun] ... ${errorLogs.length - options.diagMax} more error(s) omitted`);
    }

    for (const log of warningLogs.slice(0, options.diagMax)) {
      console.warn(`[webstir-backend][bun] ${formatEsbuildMessage(log)}`);
    }
    if (warningLogs.length > options.diagMax) {
      console.warn(`[webstir-backend][bun] ... ${warningLogs.length - options.diagMax} more warning(s) omitted`);
    }

    return {
      succeeded: result.success && errorLogs.length === 0,
      errorCount: errorLogs.length,
      warningCount: warningLogs.length,
      durationMs: end - start,
    };
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

function getBunBuild():
  | ((
      options: Record<string, unknown>
    ) => Promise<{ readonly success: boolean; readonly logs?: readonly { readonly level: string }[] }>)
  | undefined {
  const runtime = globalThis as typeof globalThis & {
    Bun?: {
      build?: (options: Record<string, unknown>) => Promise<{
        readonly success: boolean;
        readonly logs?: readonly { readonly level: string }[];
      }>;
    };
  };
  const build = runtime.Bun?.build;
  return typeof build === 'function' ? build.bind(runtime.Bun) : undefined;
}

function isEnabled(value: string | undefined): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}
