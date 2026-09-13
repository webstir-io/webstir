import path from 'node:path';
import type { CheerioAPI } from 'cheerio';
import { build as esbuild } from 'esbuild';
import { emitDiagnostic } from '../core/diagnostics.js';
import { pathExists } from '../utils/fs.js';

// A script tag marked data-webstir-inline names a TypeScript or JavaScript
// source that is bundled at build time and written into the tag itself, so it
// runs before anything paints. The build keeps the source path in the
// attribute; publish bundles it again, minified, from that path.
//
//   <script data-webstir-inline src="./scripts/first-paint.ts"></script>
//
// A relative src resolves against the file that contains the tag; a leading
// slash resolves against src/frontend, the way /app/app.js does.

export const INLINE_SCRIPT_ATTRIBUTE = 'data-webstir-inline';
const LARGE_INLINE_BYTES = 16 * 1024;
const INLINE_TAG_PATTERN = /<script\b([^>]*\bdata-webstir-inline\b[^>]*)>\s*<\/script>/gi;

export interface InlineScriptOptions {
  /** Directory the containing HTML file lives in; relative sources resolve here. */
  readonly baseDir: string;
  /** src/frontend; sources starting with "/" resolve here. */
  readonly frontendRoot: string;
  /** Recorded source paths are kept relative to this. */
  readonly workspaceRoot: string;
  readonly minify: boolean;
  /** Names the containing file in errors. */
  readonly describeContainer: string;
}

export interface InlineScriptResult {
  readonly html: string;
  /** Every file the inlined bundles were built from, absolute. */
  readonly dependencies: readonly string[];
}

/** Inlines the tags in an HTML string without re-parsing the rest of it. */
export async function inlineSourceScriptsInHtml(
  html: string,
  options: InlineScriptOptions,
): Promise<InlineScriptResult> {
  const dependencies = new Set<string>();
  let output = '';
  let cursor = 0;
  for (const match of html.matchAll(INLINE_TAG_PATTERN)) {
    const attributes = match[1] ?? '';
    const sourcePath = resolveSource(
      readAttribute(attributes, 'src'),
      readAttribute(attributes, INLINE_SCRIPT_ATTRIBUTE),
      options,
    );
    if (!sourcePath) {
      continue;
    }
    const bundle = await inlineFromSource(sourcePath, options);
    for (const input of bundle.inputs) {
      dependencies.add(input);
    }
    output += html.slice(cursor, match.index);
    output += `<script ${INLINE_SCRIPT_ATTRIBUTE}="${bundle.recorded}">${bundle.code}</script>`;
    cursor = (match.index ?? 0) + match[0].length;
  }
  output += html.slice(cursor);
  return { html: output, dependencies: [...dependencies] };
}

/** Inlines the tags in a parsed document; used where one is already loaded. */
export async function inlineSourceScripts(
  document: CheerioAPI,
  options: InlineScriptOptions,
): Promise<void> {
  const elements = document(`script[${INLINE_SCRIPT_ATTRIBUTE}]`).toArray();
  for (const element of elements) {
    const node = document(element);
    const sourcePath = resolveSource(node.attr('src'), node.attr(INLINE_SCRIPT_ATTRIBUTE), options);
    if (!sourcePath) {
      continue;
    }
    const bundle = await inlineFromSource(sourcePath, options);
    node.removeAttr('src');
    node.removeAttr('type');
    node.attr(INLINE_SCRIPT_ATTRIBUTE, bundle.recorded);
    node.text(bundle.code);
  }
}

/** The files the inline tags in this HTML depend on, for watchers. */
export async function resolveInlineScriptDependencies(
  html: string,
  options: Omit<InlineScriptOptions, 'minify'>,
): Promise<readonly string[]> {
  if (!html.includes(INLINE_SCRIPT_ATTRIBUTE)) {
    return [];
  }
  const result = await inlineSourceScriptsInHtml(html, { ...options, minify: false });
  return result.dependencies;
}

async function inlineFromSource(
  sourcePath: string,
  options: InlineScriptOptions,
): Promise<{ code: string; recorded: string; inputs: readonly string[] }> {
  if (!(await pathExists(sourcePath))) {
    throw new Error(
      `Inline script source not found: ${sourcePath} (referenced from ${options.describeContainer}).`,
    );
  }
  const bundle = await bundleInlineScript(sourcePath, options.minify);
  const recorded = toPosix(path.relative(options.workspaceRoot, sourcePath));
  const bytes = Buffer.byteLength(bundle.code);
  if (bytes > LARGE_INLINE_BYTES) {
    emitDiagnostic({
      code: 'frontend.inlineScript.large',
      kind: 'html',
      stage: options.minify ? 'html.publish' : 'html.build',
      severity: 'warning',
      message: `Inline script ${recorded} is ${Math.round(bytes / 1024)} KB; it is sent with every page that includes it.`,
      data: { source: recorded, bytes },
      suggestion:
        'Keep pre-paint scripts small; move anything that can wait for the app bundle into it.',
    });
  }
  return { code: bundle.code, recorded, inputs: bundle.inputs };
}

function resolveSource(
  src: string | undefined,
  recorded: string | undefined,
  options: InlineScriptOptions,
): string | null {
  if (src) {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith('data:')) {
      throw new Error(
        `Inline scripts must name a workspace source file, not a URL: ${src} (referenced from ${options.describeContainer}).`,
      );
    }
    return src.startsWith('/')
      ? path.join(options.frontendRoot, src)
      : path.resolve(options.baseDir, src);
  }
  if (recorded) {
    return path.resolve(options.workspaceRoot, recorded);
  }
  return null;
}

async function bundleInlineScript(
  sourcePath: string,
  minify: boolean,
): Promise<{ code: string; inputs: readonly string[] }> {
  const result = await esbuild({
    entryPoints: [sourcePath],
    bundle: true,
    write: false,
    metafile: true,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
    absWorkingDir: path.dirname(sourcePath),
  });
  const text = result.outputFiles[0]?.text ?? '';
  const inputs = Object.keys(result.metafile?.inputs ?? {}).map((input) =>
    path.resolve(path.dirname(sourcePath), input),
  );
  // A closing script tag inside the bundle would end the inline tag early.
  return { code: text.trim().replace(/<\/script/gi, '<\\/script'), inputs };
}

function readAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'),
  );
  if (!match) {
    return undefined;
  }
  return match[1] ?? match[2] ?? match[3] ?? '';
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}
