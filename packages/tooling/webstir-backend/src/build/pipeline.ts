import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import { build as esbuild, context as esbuildContext } from 'esbuild';
import { glob } from 'glob';
import type { BuildContext as EsbuildContext } from 'esbuild';

import type { ModuleDiagnostic } from '@webstir-io/module-contract';

import type { BackendBuildMode } from '../workspace.js';
import { discoverEntryPoints } from './entries.js';

export interface BackendBuildPipelineOptions {
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly tsconfigPath: string;
    readonly mode: BackendBuildMode;
    readonly env: Record<string, string | undefined>;
    readonly incremental: boolean;
    readonly diagnostics: ModuleDiagnostic[];
    readonly bundler?: BackendBundler;
}

export interface BackendBuildPipelineResult {
    readonly entryPoints: readonly string[];
    readonly outputs?: Record<string, number>;
    readonly includePublishSourcemaps: boolean;
}

export type BackendBundler = 'esbuild' | 'bun';

interface IncrementalBuildEntry {
    entrySignature: string;
    context: EsbuildContext;
}

const incrementalBuildCache = new Map<string, IncrementalBuildEntry>();

if (typeof process !== 'undefined' && typeof process.once === 'function') {
    process.once('exit', () => {
        clearIncrementalCache();
    });
}

export async function runBackendBuildPipeline(options: BackendBuildPipelineOptions): Promise<BackendBuildPipelineResult> {
    const { sourceRoot, buildRoot, tsconfigPath, diagnostics, incremental, mode } = options;
    const env = options.env ?? {};
    const bundler = options.bundler ?? resolveBackendBundler({
        env,
        incremental,
        diagnostics
    });
    console.info(`[webstir-backend] ${mode}:tsc start`);
    if (shouldTypeCheck(mode, env)) {
        await runTypeCheck(tsconfigPath, env, diagnostics);
    } else {
        diagnostics.push({ severity: 'info', message: '[webstir-backend] type-check skipped by WEBSTIR_BACKEND_TYPECHECK' });
    }
    console.info(`[webstir-backend] ${mode}:tsc done`);

    const entryPoints = await discoverEntryPoints(sourceRoot);
    if (entryPoints.length === 0) {
        diagnostics.push({
            severity: 'warn',
            message: `No backend entry points found under ${sourceRoot} (expected index.* or functions/*/index.* or jobs/*/index.*).`
        });
    }

    if (bundler === 'bun') {
        await resetBuildRoot(buildRoot);
    }

    console.info(`[webstir-backend] ${mode}:${bundler} start`);
    const outputs = bundler === 'bun'
        ? await runBunBuild({
            sourceRoot,
            buildRoot,
            tsconfigPath,
            mode,
            env,
            incremental,
            diagnostics,
            entryPoints
        })
        : await runEsbuild({
            sourceRoot,
            buildRoot,
            tsconfigPath,
            mode,
            env,
            incremental,
            diagnostics,
            entryPoints
        });
    console.info(`[webstir-backend] ${mode}:${bundler} done`);

    await ensureModuleDefinitionBuild({
        sourceRoot,
        buildRoot,
        tsconfigPath,
        mode,
        env,
        diagnostics
    });

    const includePublishSourcemaps = mode === 'publish' && shouldEmitPublishSourcemaps(env);

    return {
        entryPoints,
        outputs,
        includePublishSourcemaps
    };
}

async function runTypeCheck(tsconfigPath: string, env: Record<string, string | undefined>, diagnostics: ModuleDiagnostic[]): Promise<void> {
    if (!existsSync(tsconfigPath)) {
        diagnostics.push({
            severity: 'warn',
            message: `TypeScript config not found at ${tsconfigPath}; skipping type-check.`
        });
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const child = spawn('tsc', ['-p', tsconfigPath, '--noEmit'], {
            stdio: 'pipe',
            env: {
                ...process.env,
                ...env
            }
        });

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
        });

        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', (err: any) => {
            const code = (err && typeof err === 'object') ? (err.code as string | undefined) : undefined;
            if (code === 'ENOENT') {
                diagnostics.push({ severity: 'warn', message: 'TypeScript compiler (tsc) not found in PATH; skipping type-check.' });
                resolve();
                return;
            }
            reject(err);
        });
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                diagnostics.push({
                    severity: 'error',
                    message: `Type checking failed (exit code ${code}).`,
                    file: tsconfigPath
                });
                if (stderr.trim()) {
                    diagnostics.push({ severity: 'error', message: stderr.trim() });
                }
                if (stdout.trim()) {
                    diagnostics.push({ severity: 'info', message: stdout.trim() });
                }
                reject(new Error('Type checking failed.'));
            }
        });
    });
}

export function shouldTypeCheck(mode: BackendBuildMode, env: Record<string, string | undefined>): boolean {
    const flag = env?.WEBSTIR_BACKEND_TYPECHECK;
    if (typeof flag === 'string' && flag.toLowerCase() === 'skip') {
        return false;
    }
    if (mode === 'publish') {
        return true;
    }
    return true;
}

interface ResolveBackendBundlerOptions {
    readonly env: Record<string, string | undefined>;
    readonly incremental: boolean;
    readonly diagnostics?: ModuleDiagnostic[];
}

export function resolveBackendBundler(options: ResolveBackendBundlerOptions): BackendBundler {
    const requestedBundler = normalizeBackendBundler(options.env?.WEBSTIR_BACKEND_BUNDLER);
    if (requestedBundler !== 'bun') {
        return 'esbuild';
    }

    if (options.incremental) {
        options.diagnostics?.push({
            severity: 'info',
            message: '[webstir-backend] WEBSTIR_BACKEND_BUNDLER=bun requested for an incremental build; falling back to esbuild.'
        });
        return 'esbuild';
    }

    if (!getBunBuild()) {
        options.diagnostics?.push({
            severity: 'warn',
            message: '[webstir-backend] WEBSTIR_BACKEND_BUNDLER=bun requested outside a Bun runtime; falling back to esbuild.'
        });
        return 'esbuild';
    }

    return 'bun';
}

function normalizeBackendBundler(rawBundler: unknown): BackendBundler {
    return typeof rawBundler === 'string' && rawBundler.trim().toLowerCase() === 'bun' ? 'bun' : 'esbuild';
}

function shouldEmitPublishSourcemaps(env: Record<string, string | undefined>): boolean {
    const flag = env?.WEBSTIR_BACKEND_SOURCEMAPS;
    if (typeof flag !== 'string') {
        return false;
    }
    const normalized = flag.trim().toLowerCase();
    return normalized === 'on' || normalized === 'true' || normalized === '1' || normalized === 'yes';
}

async function discoverModuleDefinitionSource(sourceRoot: string): Promise<string | undefined> {
    const patterns = ['module.{ts,tsx,js,mjs}', 'module/index.{ts,tsx,js,mjs}'];

    for (const pattern of patterns) {
        const matches = await glob(pattern, {
            cwd: sourceRoot,
            absolute: true,
            nodir: true,
            dot: false
        });

        if (matches.length > 0) {
            return matches[0];
        }
    }

    const indexPatterns = ['index.{ts,tsx,js,mjs}'];
    for (const pattern of indexPatterns) {
        const matches = await glob(pattern, {
            cwd: sourceRoot,
            absolute: true,
            nodir: true,
            dot: false
        });

        for (const candidate of matches) {
            if (await sourceExportsNamedModuleDefinition(candidate)) {
                return candidate;
            }
        }
    }

    return undefined;
}

async function sourceExportsNamedModuleDefinition(sourceFile: string): Promise<boolean> {
    try {
        const source = await readFile(sourceFile, 'utf8');
        return /\bexport\s+(const|let|var)\s+module\b/.test(source)
            || /\bexport\s*\{\s*module\b/.test(source);
    } catch {
        return false;
    }
}

export interface EnsureModuleDefinitionBuildOptions {
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly tsconfigPath: string;
    readonly mode: BackendBuildMode;
    readonly env: Record<string, string | undefined>;
    readonly diagnostics: ModuleDiagnostic[];
}

export async function ensureModuleDefinitionBuild(options: EnsureModuleDefinitionBuildOptions): Promise<void> {
    const moduleSource = await discoverModuleDefinitionSource(options.sourceRoot);
    if (!moduleSource) {
        return;
    }

    await buildModuleDefinition({
        sourceFile: moduleSource,
        sourceRoot: options.sourceRoot,
        buildRoot: options.buildRoot,
        tsconfigPath: options.tsconfigPath,
        mode: options.mode,
        env: options.env,
        diagnostics: options.diagnostics
    });
}

interface ModuleDefinitionBuildOptions {
    readonly sourceFile: string;
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly tsconfigPath: string;
    readonly mode: BackendBuildMode;
    readonly env: Record<string, string | undefined>;
    readonly diagnostics: ModuleDiagnostic[];
}

async function buildModuleDefinition(options: ModuleDefinitionBuildOptions): Promise<void> {
    const { sourceFile, sourceRoot, buildRoot, tsconfigPath, mode, env, diagnostics } = options;

    const isProduction = mode === 'publish';
    const nodeEnv = env?.NODE_ENV ?? (isProduction ? 'production' : 'development');
    const emitPublishSourcemaps = isProduction && shouldEmitPublishSourcemaps(env);
    const define: Record<string, string> = {
        'process.env.NODE_ENV': JSON.stringify(nodeEnv)
    };

    try {
        await esbuild({
            entryPoints: [sourceFile],
            bundle: true,
            packages: 'external',
            platform: 'node',
            target: 'node20',
            format: 'esm',
            sourcemap: isProduction ? emitPublishSourcemaps : true,
            outfile: path.join(buildRoot, 'module.js'),
            tsconfig: existsSync(tsconfigPath) ? tsconfigPath : undefined,
            define,
            logLevel: 'silent'
        });
    } catch (error) {
        if (isEsbuildFailure(error)) {
            for (const e of error.errors ?? []) {
                diagnostics.push({ severity: 'error', message: formatEsbuildMessage(e) });
            }
            for (const w of error.warnings ?? []) {
                diagnostics.push({ severity: 'warn', message: formatEsbuildMessage(w) });
            }
        } else if (error instanceof Error) {
            diagnostics.push({ severity: 'error', message: error.message });
        } else {
            diagnostics.push({ severity: 'error', message: String(error) });
        }
    }
}

interface SupportFileBuildOptions {
    readonly sourceFile: string;
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly tsconfigPath: string;
    readonly mode: BackendBuildMode;
    readonly env: Record<string, string | undefined>;
    readonly diagnostics: ModuleDiagnostic[];
    readonly bundler?: BackendBundler;
}

export async function buildSupportFile(options: SupportFileBuildOptions): Promise<void> {
    const { sourceFile, sourceRoot, buildRoot, tsconfigPath, mode, env, diagnostics } = options;
    const isProduction = mode === 'publish';
    const nodeEnv = env?.NODE_ENV ?? (isProduction ? 'production' : 'development');
    const emitPublishSourcemaps = isProduction && shouldEmitPublishSourcemaps(env);
    const define: Record<string, string> = {
        'process.env.NODE_ENV': JSON.stringify(nodeEnv)
    };
    const bundler = options.bundler ?? resolveBackendBundler({
        env,
        incremental: false,
        diagnostics
    });
    const diagMax = readDiagMax(env, 50);

    try {
        if (bundler === 'bun') {
            const result = await runBunCompile({
                entryPoints: [sourceFile],
                sourceRoot,
                buildRoot,
                tsconfigPath,
                define,
                minify: false,
                includeSourceMaps: isProduction ? emitPublishSourcemaps : true
            });
            ensureBunCompileSucceeded(result, diagnostics, `${mode}:bun:support`, diagMax);
        } else {
            await esbuild({
                entryPoints: [sourceFile],
                bundle: false,
                platform: 'node',
                target: 'node20',
                format: 'esm',
                sourcemap: isProduction ? emitPublishSourcemaps : true,
                outdir: buildRoot,
                outbase: sourceRoot,
                tsconfig: existsSync(tsconfigPath) ? tsconfigPath : undefined,
                define,
                logLevel: 'silent'
            });
        }
    } catch (error) {
        if (error instanceof Error) {
            diagnostics.push({ severity: 'error', message: error.message });
        } else {
            diagnostics.push({ severity: 'error', message: String(error) });
        }
        throw error;
    }
}

interface BuildOptions {
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly tsconfigPath: string;
    readonly mode: BackendBuildMode;
    readonly env: Record<string, string | undefined>;
    readonly incremental: boolean;
    readonly diagnostics: ModuleDiagnostic[];
    readonly entryPoints: readonly string[];
}

async function runEsbuild(options: BuildOptions): Promise<Record<string, number> | undefined> {
    const { sourceRoot, buildRoot, tsconfigPath, mode, env, diagnostics, entryPoints } = options;
    const isProduction = mode === 'publish';
    const useIncremental = !isProduction && options.incremental === true;
    const incrementalKey = useIncremental ? createIncrementalKey(mode, buildRoot) : undefined;

    if (!entryPoints || entryPoints.length === 0) {
        if (incrementalKey) {
            await disposeIncrementalBuild(incrementalKey);
        }
        return undefined;
    }

    const entrySignature = useIncremental ? createEntrySignature(entryPoints) : undefined;
    const nodeEnv = env?.NODE_ENV ?? (isProduction ? 'production' : 'development');
    const diagMax = readDiagMax(env, 50);

    const define: Record<string, string> = {
        'process.env.NODE_ENV': JSON.stringify(nodeEnv)
    };

    const emitPublishSourcemaps = isProduction && shouldEmitPublishSourcemaps(env);
    const start = performance.now();
    try {
        let reusedIncremental = false;
        let result: Awaited<ReturnType<typeof esbuild>>;

        if (isProduction) {
            if (incrementalKey) {
                await disposeIncrementalBuild(incrementalKey);
            }
            result = await esbuild({
                entryPoints: entryPoints as string[],
                bundle: true,
                packages: 'external',
                platform: 'node',
                target: 'node20',
                format: 'esm',
                minify: true,
                sourcemap: emitPublishSourcemaps,
                legalComments: 'none',
                outdir: buildRoot,
                outbase: sourceRoot,
                entryNames: '[dir]/[name]',
                tsconfig: existsSync(tsconfigPath) ? tsconfigPath : undefined,
                define,
                logLevel: 'silent',
                metafile: true
            });
        } else if (useIncremental && incrementalKey && entrySignature) {
            const cached = incrementalBuildCache.get(incrementalKey);
            if (cached && cached.entrySignature === entrySignature) {
                reusedIncremental = true;
                result = await cached.context.rebuild();
            } else {
                if (cached) {
                    await disposeIncrementalBuild(incrementalKey);
                }
                const ctx = await esbuildContext({
                    entryPoints: entryPoints as string[],
                    bundle: false,
                    platform: 'node',
                    target: 'node20',
                    format: 'esm',
                    sourcemap: true,
                    outdir: buildRoot,
                    outbase: sourceRoot,
                    tsconfig: existsSync(tsconfigPath) ? tsconfigPath : undefined,
                    define,
                    logLevel: 'silent',
                    metafile: true
                });
                incrementalBuildCache.set(incrementalKey, {
                    entrySignature,
                    context: ctx
                });
                result = await ctx.rebuild();
            }
        } else {
            if (incrementalKey) {
                await disposeIncrementalBuild(incrementalKey);
            }
            result = await esbuild({
                entryPoints: entryPoints as string[],
                bundle: false,
                platform: 'node',
                target: 'node20',
                format: 'esm',
                sourcemap: true,
                outdir: buildRoot,
                outbase: sourceRoot,
                tsconfig: existsSync(tsconfigPath) ? tsconfigPath : undefined,
                define,
                logLevel: 'silent',
                metafile: true
            });
        }

        const warnCount = result.warnings?.length ?? 0;
        for (const w of (result.warnings ?? []).slice(0, diagMax)) {
            diagnostics.push({ severity: 'warn', message: formatEsbuildMessage(w) });
        }
        if (warnCount > diagMax) {
            diagnostics.push({
                severity: 'info',
                message: `[webstir-backend] ${isProduction ? 'publish:esbuild' : `${mode}:esbuild`} ... ${warnCount - diagMax} more warning(s) omitted`
            });
        }
        const end = performance.now();
        const reuseSuffix = reusedIncremental ? ' (incremental)' : '';
        diagnostics.push({
            severity: 'info',
            message: `[webstir-backend] ${isProduction ? 'publish:esbuild' : `${mode}:esbuild`} 0 error(s), ${warnCount} warning(s) in ${(end - start).toFixed(1)}ms${reuseSuffix}`
        });

        return collectOutputSizes((result as any).metafile, buildRoot);
    } catch (error) {
        const end = performance.now();
        if (incrementalKey) {
            await disposeIncrementalBuild(incrementalKey);
        }
        if (isEsbuildFailure(error)) {
            const errs = error.errors ?? [];
            const warns = error.warnings ?? [];
            for (const e of errs.slice(0, diagMax)) {
                diagnostics.push({ severity: 'error', message: formatEsbuildMessage(e) });
            }
            for (const w of warns.slice(0, diagMax)) {
                diagnostics.push({ severity: 'warn', message: formatEsbuildMessage(w) });
            }
            if (errs.length > diagMax) {
                diagnostics.push({ severity: 'info', message: `[webstir-backend] ${mode}:esbuild ... ${errs.length - diagMax} more error(s) omitted` });
            }
            if (warns.length > diagMax) {
                diagnostics.push({ severity: 'info', message: `[webstir-backend] ${mode}:esbuild ... ${warns.length - diagMax} more warning(s) omitted` });
            }
            diagnostics.push({ severity: 'info', message: `[webstir-backend] ${mode}:esbuild ${errs.length} error(s), ${warns.length} warning(s) in ${(end - start).toFixed(1)}ms` });
        } else if (error instanceof Error) {
            diagnostics.push({ severity: 'error', message: error.message });
        } else {
            diagnostics.push({ severity: 'error', message: String(error) });
        }
        throw new Error('esbuild failed.');
    }
}

interface BunBuildOutputFile {
    readonly path: string;
    readonly kind?: string;
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

interface BunCompileOptions {
    readonly entryPoints: readonly string[];
    readonly sourceRoot: string;
    readonly buildRoot: string;
    readonly tsconfigPath: string;
    readonly define: Record<string, string>;
    readonly minify: boolean;
    readonly includeSourceMaps: boolean;
}

async function runBunBuild(options: BuildOptions): Promise<Record<string, number> | undefined> {
    const { sourceRoot, buildRoot, tsconfigPath, mode, env, diagnostics, entryPoints } = options;
    const isProduction = mode === 'publish';

    if (!entryPoints || entryPoints.length === 0) {
        return undefined;
    }

    const nodeEnv = env?.NODE_ENV ?? (isProduction ? 'production' : 'development');
    const diagMax = readDiagMax(env, 50);
    const define: Record<string, string> = {
        'process.env.NODE_ENV': JSON.stringify(nodeEnv)
    };
    const emitPublishSourcemaps = isProduction && shouldEmitPublishSourcemaps(env);
    const start = performance.now();

    try {
        const result = await runBunCompile({
            entryPoints,
            sourceRoot,
            buildRoot,
            tsconfigPath,
            define,
            minify: isProduction,
            includeSourceMaps: isProduction ? emitPublishSourcemaps : true
        });
        const { errorCount, warningCount } = pushBunLogs(diagnostics, result.logs, `${mode}:bun`, diagMax);

        const end = performance.now();
        diagnostics.push({
            severity: 'info',
            message: `[webstir-backend] ${mode}:bun ${errorCount} error(s), ${warningCount} warning(s) in ${(end - start).toFixed(1)}ms`
        });

        if (!result.success || errorCount > 0) {
            throw new Error('bun build failed.');
        }

        return collectBunOutputSizes(result.outputs, buildRoot);
    } catch (error) {
        const end = performance.now();
        if (error instanceof Error) {
            diagnostics.push({ severity: 'error', message: error.message });
        } else {
            diagnostics.push({ severity: 'error', message: String(error) });
        }
        diagnostics.push({
            severity: 'info',
            message: `[webstir-backend] ${mode}:bun failed in ${(end - start).toFixed(1)}ms`
        });
        throw new Error('bun build failed.');
    }
}

async function runBunCompile(options: BunCompileOptions): Promise<BunBuildOutput> {
    const build = getBunBuild();
    if (!build) {
        throw new Error('Bun.build() is not available in the current runtime.');
    }

    return await build({
        entrypoints: [...options.entryPoints],
        root: options.sourceRoot,
        outdir: options.buildRoot,
        target: 'node',
        format: 'esm',
        splitting: false,
        packages: 'external',
        minify: options.minify,
        sourcemap: options.includeSourceMaps ? 'linked' : 'none',
        tsconfig: existsSync(options.tsconfigPath) ? options.tsconfigPath : undefined,
        define: options.define,
        throw: false
    });
}

function ensureBunCompileSucceeded(
    result: BunBuildOutput,
    diagnostics: ModuleDiagnostic[],
    label: string,
    diagMax: number
): void {
    const { errorCount } = pushBunLogs(diagnostics, result.logs, label, diagMax);
    if (!result.success || errorCount > 0) {
        throw new Error('bun build failed.');
    }
}

function pushBunLogs(
    diagnostics: ModuleDiagnostic[],
    logs: readonly BunBuildLog[] | undefined,
    label: string,
    diagMax: number
): { errorCount: number; warningCount: number } {
    const entries = Array.isArray(logs) ? logs : [];
    const errorLogs = entries.filter((log) => log.level === 'error');
    const warningLogs = entries.filter((log) => log.level === 'warning');

    for (const entry of errorLogs.slice(0, diagMax)) {
        diagnostics.push({ severity: 'error', message: formatEsbuildMessage(entry) });
    }
    for (const entry of warningLogs.slice(0, diagMax)) {
        diagnostics.push({ severity: 'warn', message: formatEsbuildMessage(entry) });
    }
    if (errorLogs.length > diagMax) {
        diagnostics.push({ severity: 'info', message: `[webstir-backend] ${label} ... ${errorLogs.length - diagMax} more error(s) omitted` });
    }
    if (warningLogs.length > diagMax) {
        diagnostics.push({ severity: 'info', message: `[webstir-backend] ${label} ... ${warningLogs.length - diagMax} more warning(s) omitted` });
    }

    return {
        errorCount: errorLogs.length,
        warningCount: warningLogs.length
    };
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

function collectBunOutputSizes(outputs: readonly BunBuildOutputFile[] | undefined, buildRoot: string): Record<string, number> {
    const collected: Record<string, number> = {};
    for (const output of outputs ?? []) {
        const rel = path.relative(buildRoot, output.path);
        collected[rel] = typeof output.size === 'number' ? output.size : 0;
    }
    return collected;
}

async function resetBuildRoot(buildRoot: string): Promise<void> {
    await rm(buildRoot, { recursive: true, force: true });
    await mkdir(buildRoot, { recursive: true });
}

function readDiagMax(env: Record<string, string | undefined>, fallback: number): number {
    const raw = env?.WEBSTIR_BACKEND_DIAG_MAX;
    const n = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createIncrementalKey(mode: BackendBuildMode, buildRoot: string): string {
    return `${mode}:${path.resolve(buildRoot)}`;
}

async function disposeIncrementalBuild(key: string): Promise<void> {
    const cached = incrementalBuildCache.get(key);
    if (cached) {
        try {
            await cached.context.dispose();
        } catch {
            // ignore
        }
        incrementalBuildCache.delete(key);
    }
}

function clearIncrementalCache(): void {
    for (const [key, entry] of incrementalBuildCache.entries()) {
        try {
            entry.context.dispose();
        } catch {
            // ignore
        }
        incrementalBuildCache.delete(key);
    }
}

function createEntrySignature(entryPoints: readonly string[]): string {
    return Array.from(entryPoints).sort().join('|');
}

export function collectOutputSizes(metafile: unknown, buildRoot: string): Record<string, number> {
    const outputs: Record<string, number> = {};
    if (!metafile || typeof metafile !== 'object') {
        return outputs;
    }
    const mf = metafile as { outputs?: Record<string, { bytes?: number }> };
    for (const [outPath, info] of Object.entries(mf.outputs ?? {})) {
        const rel = path.relative(buildRoot, outPath);
        outputs[rel] = typeof info.bytes === 'number' ? info.bytes : 0;
    }
    return outputs;
}

function isEsbuildFailure(error: unknown): error is { errors?: readonly any[]; warnings?: readonly any[] } {
    return typeof error === 'object' && error !== null && ('errors' in (error as any) || 'warnings' in (error as any));
}

export function formatEsbuildMessage(msg: any): string {
    const text =
        typeof msg?.message === 'string'
            ? msg.message
            : typeof msg?.text === 'string'
              ? msg.text
              : String(msg);
    const loc = msg?.location ?? msg?.position;
    if (loc && typeof loc.file === 'string') {
        const position = typeof loc.line === 'number' ? `${loc.line}:${loc.column ?? 1}` : '1:1';
        return `${loc.file}:${position} ${text}`;
    }
    return text;
}
