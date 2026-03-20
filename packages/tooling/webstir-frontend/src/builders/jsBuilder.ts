import path from 'node:path';
import { build as esbuild, type Metafile } from 'esbuild';
import { FOLDERS, FILES, EXTENSIONS } from '../core/constants.js';
import type { Builder, BuilderContext } from './types.js';
import { getPages } from '../core/pages.js';
import { ensureDir, pathExists, copy, remove, stat } from '../utils/fs.js';
import { scanGlob } from '../utils/glob.js';
import { updatePageManifest, updateSharedAssets, readSharedAssets } from '../assets/assetManifest.js';
import { createCompressedVariants } from '../assets/precompression.js';
import { shouldProcess } from '../utils/changedFile.js';
import { findPageFromChangedFile } from '../utils/pathMatch.js';

const ENTRY_EXTENSIONS = ['.ts', '.tsx', '.js'];
const APP_ENTRY_BASENAME = 'app';
type JavaScriptBundler = 'esbuild' | 'bun';

interface BunBuildOutputFile {
    readonly path: string;
    readonly kind?: string;
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

export function createJavaScriptBuilder(context: BuilderContext): Builder {
    return {
        name: 'javascript',
        async build(): Promise<void> {
            await bundleJavaScript(context, false);
        },
        async publish(): Promise<void> {
            await bundleJavaScript(context, true);
        }
    };
}

async function bundleJavaScript(context: BuilderContext, isProduction: boolean): Promise<void> {
    const { config } = context;
    const bundler = resolveJavaScriptBundler(context.env);
    if (!shouldProcess(context, [
        {
            directory: config.paths.src.frontend,
            extensions: [EXTENSIONS.ts, EXTENSIONS.js, '.tsx', '.jsx']
        }
    ])) {
        return;
    }
    const targetPage = findPageFromChangedFile(context.changedFile, config.paths.src.pages);
    const pages = await getPages(config.paths.src.pages);
    let builtAny = false;

    await assertFeatureModulesPresent(config, context.enable);
    await compileAppTypeScript(context, isProduction, bundler);

    for (const page of pages) {
        if (targetPage && page.name !== targetPage) {
            continue;
        }
        const entryPoint = await resolveEntryPoint(page.directory);
        if (!entryPoint) {
            continue;
        }

        builtAny = true;

        if (isProduction) {
            await buildForProduction(config, page.name, entryPoint, bundler);
        } else {
            await buildForDevelopment(config, page.name, entryPoint, bundler);
        }
    }

    // Always copy dev runtime scripts in dev builds to support HMR/refresh even when no page JS exists.
    if (!isProduction || context.enable?.clientNav || context.enable?.search) {
        await copyRuntimeScripts(config, context.enable, isProduction);
    }
}

async function compileAppTypeScript(context: BuilderContext, isProduction: boolean, bundler: JavaScriptBundler): Promise<void> {
    const { config } = context;
    const appRoot = config.paths.src.app;
    if (!(await pathExists(appRoot))) {
        return;
    }

    if (isProduction) {
        const entryPoint = await resolveAppEntry(appRoot);
        if (!entryPoint) {
            return;
        }

        const outputDir = path.join(config.paths.dist.frontend, FOLDERS.app);
        await ensureDir(outputDir);

        const fileName = bundler === 'bun'
            ? await buildAppForProductionWithBun(outputDir, entryPoint)
            : await buildAppForProductionWithEsbuild(outputDir, entryPoint);
        const absolutePath = path.join(outputDir, fileName);

        if (config.features.precompression) {
            await createCompressedVariants(absolutePath);
        } else {
            await Promise.all([
                remove(`${absolutePath}${EXTENSIONS.br}`).catch(() => undefined),
                remove(`${absolutePath}${EXTENSIONS.gz}`).catch(() => undefined)
            ]);
        }

        const existing = await readSharedAssets(config.paths.dist.frontend);
        const previousFile = existing?.js;
        if (previousFile && previousFile !== fileName) {
            const previousPath = path.join(outputDir, previousFile);
            await remove(previousPath).catch(() => undefined);
            await remove(`${previousPath}${EXTENSIONS.br}`).catch(() => undefined);
            await remove(`${previousPath}${EXTENSIONS.gz}`).catch(() => undefined);
        }

        await updateSharedAssets(config.paths.dist.frontend, shared => {
            shared.js = fileName;
        });

        return;
    }

    const entryPoint = await resolveAppEntry(appRoot);
    if (!entryPoint) {
        return;
    }

    const outdir = path.join(config.paths.build.frontend, FOLDERS.app);
    await ensureDir(outdir);

    if (bundler === 'bun') {
        await buildForDevelopmentWithBun(outdir, entryPoint);
        return;
    }

    await buildAppForDevelopmentWithEsbuild(outdir, entryPoint);
}

async function buildForDevelopment(
    config: BuilderContext['config'],
    pageName: string,
    entryPoint: string,
    bundler: JavaScriptBundler
): Promise<void> {
    const outputDir = path.join(config.paths.build.pages, pageName);
    await ensureDir(outputDir);
    if (bundler === 'bun') {
        await buildForDevelopmentWithBun(outputDir, entryPoint);
        return;
    }

    const outfile = path.join(outputDir, `${FILES.index}${EXTENSIONS.js}`);

    await esbuild({
        entryPoints: [entryPoint],
        bundle: true,
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
        sourcemap: true,
        outfile,
        logLevel: 'silent'
    });
}

async function buildForProduction(
    config: BuilderContext['config'],
    pageName: string,
    entryPoint: string,
    bundler: JavaScriptBundler
): Promise<void> {
    const outputDir = path.join(config.paths.dist.pages, pageName);
    await ensureDir(outputDir);

    const fileName = bundler === 'bun'
        ? await buildPageForProductionWithBun(outputDir, pageName, entryPoint)
        : await buildPageForProductionWithEsbuild(outputDir, pageName, entryPoint);
    const absolutePath = path.join(outputDir, fileName);
    if (config.features.precompression) {
        await createCompressedVariants(absolutePath);
    } else {
        await Promise.all([
            remove(`${absolutePath}${EXTENSIONS.br}`).catch(() => undefined),
            remove(`${absolutePath}${EXTENSIONS.gz}`).catch(() => undefined)
        ]);
    }
    await updatePageManifest(outputDir, pageName, (manifest) => {
        manifest.js = fileName;
    });
}

async function buildAppForProductionWithEsbuild(outputDir: string, entryPoint: string): Promise<string> {
    const result = await esbuild({
        entryPoints: [entryPoint],
        outdir: outputDir,
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
        minify: true,
        sourcemap: false,
        bundle: true,
        entryNames: 'app-[hash]',
        assetNames: 'assets/[name]-[hash]',
        metafile: true,
        logLevel: 'silent'
    });

    const fileName = await resolveAppBundleName(outputDir, entryPoint, result.metafile);
    if (!fileName) {
        throw new Error(`esbuild did not produce an app bundle for ${entryPoint}.`);
    }

    return fileName;
}

async function buildAppForProductionWithBun(outputDir: string, entryPoint: string): Promise<string> {
    const result = await runBunBrowserBuild({
        entryPoint,
        root: path.dirname(entryPoint),
        outputDir,
        minify: true,
        sourcemap: 'none',
        naming: {
            entry: 'app-[hash].js',
            asset: 'assets/[name]-[hash].[ext]'
        }
    });
    ensureBunBuildSucceeded(result, `app bundle ${entryPoint}`);

    const fileName = resolveBunEntryOutputName(result.outputs, outputDir, (name) => {
        return name.startsWith('app-') && name.endsWith(EXTENSIONS.js);
    });
    if (!fileName) {
        throw new Error(`Bun.build() did not produce an app bundle for ${entryPoint}.`);
    }

    return fileName;
}

async function buildForDevelopmentWithBun(outputDir: string, entryPoint: string): Promise<void> {
    const result = await runBunBrowserBuild({
        entryPoint,
        root: path.dirname(entryPoint),
        outputDir,
        minify: false,
        sourcemap: 'linked'
    });
    ensureBunBuildSucceeded(result, `development bundle ${entryPoint}`);
}

async function buildAppForDevelopmentWithEsbuild(outputDir: string, entryPoint: string): Promise<void> {
    await esbuild({
        entryPoints: [entryPoint],
        outdir: outputDir,
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
        sourcemap: 'linked',
        bundle: true,
        logLevel: 'silent'
    });
}

async function buildPageForProductionWithEsbuild(outputDir: string, pageName: string, entryPoint: string): Promise<string> {
    const result = await esbuild({
        entryPoints: [entryPoint],
        bundle: true,
        format: 'esm',
        target: 'es2020',
        platform: 'browser',
        minify: true,
        sourcemap: false,
        outdir: outputDir,
        entryNames: `${FILES.index}-[hash]`,
        assetNames: 'assets/[name]-[hash]',
        metafile: true,
        logLevel: 'silent'
    });

    const outputs = result.metafile?.outputs ?? {};
    const scriptPath = Object.keys(outputs).find((file) => file.endsWith('.js'));
    if (!scriptPath) {
        throw new Error(`esbuild did not produce a JavaScript bundle for page '${pageName}'.`);
    }

    return path.basename(scriptPath);
}

async function buildPageForProductionWithBun(outputDir: string, pageName: string, entryPoint: string): Promise<string> {
    const result = await runBunBrowserBuild({
        entryPoint,
        root: path.dirname(entryPoint),
        outputDir,
        minify: true,
        sourcemap: 'none',
        naming: {
            entry: `${FILES.index}-[hash].js`,
            asset: 'assets/[name]-[hash].[ext]'
        }
    });
    ensureBunBuildSucceeded(result, `page bundle '${pageName}'`);

    const fileName = resolveBunEntryOutputName(result.outputs, outputDir, (name) => {
        return name.startsWith(`${FILES.index}-`) && name.endsWith(EXTENSIONS.js);
    });
    if (!fileName) {
        throw new Error(`Bun.build() did not produce a JavaScript bundle for page '${pageName}'.`);
    }

    return fileName;
}

async function copyRuntimeScripts(
    config: BuilderContext['config'],
    enable: BuilderContext['enable'],
    isProduction: boolean
): Promise<void> {
    const scripts = [
        // Always copy dev runtime in dev builds to support live reload, even if no page JS exists.
        { name: FILES.refreshJs, copyToDist: false, required: !isProduction },
        { name: FILES.hmrJs, copyToDist: false, required: !isProduction }
    ];

    for (const script of scripts) {
        if (!script.required) {
            continue;
        }

        const source = path.join(config.paths.src.app, script.name);
        if (!(await pathExists(source))) {
            continue;
        }

        const buildDestination = path.join(config.paths.build.frontend, script.name);
        await ensureDir(path.dirname(buildDestination));
        await copy(source, buildDestination);

        if (isProduction && script.copyToDist) {
            const distDestination = path.join(config.paths.dist.frontend, script.name);
            await ensureDir(path.dirname(distDestination));
            await copy(source, distDestination);
        }
    }
}

async function resolveEntryPoint(pageDirectory: string): Promise<string | null> {
    for (const extension of ENTRY_EXTENSIONS) {
        const candidate = path.join(pageDirectory, `${FILES.index}${extension}`);
        if (await pathExists(candidate)) {
            return candidate;
        }
    }

    return null;
}

async function assertFeatureModulesPresent(config: BuilderContext['config'], enable: BuilderContext['enable']): Promise<void> {
    if (!enable) {
        return;
    }

    const missing: string[] = [];

    if (enable.clientNav === true) {
        const hasClientNav = await hasFeatureModule(config, 'client-nav');
        if (!hasClientNav) {
            missing.push('client-nav');
        }
    }

    if (enable.search === true) {
        const hasSearch = await hasFeatureModule(config, 'search');
        if (!hasSearch) {
            missing.push('search');
        }
    }

    if (enable.contentNav === true) {
        const hasContentNav = await hasFeatureModule(config, 'content-nav');
        if (!hasContentNav) {
            missing.push('content-nav');
        }
    }

    if (missing.length === 0) {
        return;
    }

    const expected = missing
        .map((name) => `src/frontend/app/scripts/features/${name}.ts`)
        .join(', ');
    throw new Error(
        `Enabled feature module(s) missing: ${missing.join(', ')}. Run 'webstir enable <feature>' to scaffold them (expected: ${expected}).`
    );
}

async function hasFeatureModule(config: BuilderContext['config'], name: string): Promise<boolean> {
    const root = path.join(config.paths.src.app, 'scripts', 'features');
    return await pathExists(path.join(root, `${name}${EXTENSIONS.ts}`))
        || await pathExists(path.join(root, `${name}${EXTENSIONS.js}`));
}

async function resolveAppBundleName(
    outputDir: string,
    entryPoint: string,
    metafile?: Metafile
): Promise<string | null> {
    const outputs = metafile?.outputs ?? {};
    const outputEntries = Object.entries(outputs) as Array<[string, Metafile['outputs'][string]]>;
    const entryOutput = outputEntries.find(([, meta]) => {
        if (!meta.entryPoint) {
            return false;
        }
        return path.resolve(meta.entryPoint) === path.resolve(entryPoint);
    });

    if (entryOutput) {
        return path.basename(entryOutput[0]);
    }

    const matches = await scanGlob('app-*.js', { cwd: outputDir });
    if (matches.length === 0) {
        return null;
    }

    if (matches.length === 1) {
        return matches[0] ?? null;
    }

    let latest: { name: string; time: number } | null = null;
    for (const name of matches) {
        const info = await stat(path.join(outputDir, name));
        const time = info.mtimeMs;
        if (!latest || time > latest.time) {
            latest = { name, time };
        }
    }

    return latest?.name ?? matches[0] ?? null;
}

async function runBunBrowserBuild(options: {
    readonly entryPoint: string;
    readonly root: string;
    readonly outputDir: string;
    readonly minify: boolean;
    readonly sourcemap: 'linked' | 'none';
    readonly naming?: {
        readonly entry: string;
        readonly asset: string;
    };
}): Promise<BunBuildOutput> {
    const build = getBunBuild();
    if (!build) {
        throw new Error('Bun.build() is not available in the current runtime.');
    }

    return await build({
        entrypoints: [options.entryPoint],
        root: options.root,
        outdir: options.outputDir,
        target: 'browser',
        format: 'esm',
        minify: options.minify,
        sourcemap: options.sourcemap,
        splitting: false,
        naming: options.naming,
        throw: false
    });
}

function resolveJavaScriptBundler(env: Record<string, string | undefined> | undefined): JavaScriptBundler {
    const requestedBundler = normalizeJavaScriptBundler(env?.WEBSTIR_FRONTEND_BUNDLER);
    if (requestedBundler !== 'bun') {
        return 'esbuild';
    }

    if (!getBunBuild()) {
        console.warn('[webstir-frontend] WEBSTIR_FRONTEND_BUNDLER=bun requested outside a Bun runtime; falling back to esbuild.');
        return 'esbuild';
    }

    return 'bun';
}

function normalizeJavaScriptBundler(rawBundler: unknown): JavaScriptBundler {
    return typeof rawBundler === 'string' && rawBundler.trim().toLowerCase() === 'bun' ? 'bun' : 'esbuild';
}

function resolveBunEntryOutputName(
    outputs: readonly BunBuildOutputFile[] | undefined,
    outputDir: string,
    matcher: (fileName: string) => boolean
): string | null {
    const normalizedOutputDir = path.resolve(outputDir);
    for (const output of outputs ?? []) {
        if (output.kind !== 'entry-point') {
            continue;
        }
        if (path.resolve(path.dirname(output.path)) !== normalizedOutputDir) {
            continue;
        }
        const fileName = path.basename(output.path);
        if (matcher(fileName)) {
            return fileName;
        }
    }

    return null;
}

function ensureBunBuildSucceeded(result: BunBuildOutput, label: string): void {
    const errors = (result.logs ?? [])
        .filter((entry) => entry.level === 'error')
        .map((entry) => formatBunBuildMessage(entry));
    if (!result.success || errors.length > 0) {
        throw new Error(errors[0] ?? `Bun.build() failed for ${label}.`);
    }
}

function formatBunBuildMessage(entry: BunBuildLog): string {
    const text =
        typeof entry.message === 'string'
            ? entry.message
            : typeof entry.text === 'string'
              ? entry.text
              : 'Bun.build() failed.';
    const position = entry.position;
    if (position?.file) {
        const line = typeof position.line === 'number' ? position.line : 1;
        const column = typeof position.column === 'number' ? position.column : 1;
        return `${position.file}:${line}:${column} ${text}`;
    }
    return text;
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

async function resolveAppEntry(appRoot: string): Promise<string | null> {
    const candidates = [
        `${APP_ENTRY_BASENAME}${EXTENSIONS.ts}`,
        `${APP_ENTRY_BASENAME}.tsx`,
        `${APP_ENTRY_BASENAME}${EXTENSIONS.js}`,
        `${APP_ENTRY_BASENAME}.jsx`
    ];

    for (const candidate of candidates) {
        const fullPath = path.join(appRoot, candidate);
        if (await pathExists(fullPath)) {
            return fullPath;
        }
    }

    return null;
}
