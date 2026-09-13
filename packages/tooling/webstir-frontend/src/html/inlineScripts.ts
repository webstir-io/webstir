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
    if (!(await pathExists(sourcePath))) {
      throw new Error(
        `Inline script source not found: ${sourcePath} (referenced from ${options.describeContainer}).`,
      );
    }

    const code = await bundleInlineScript(sourcePath, options.minify);
    const recorded = toPosix(path.relative(options.workspaceRoot, sourcePath));
    if (Buffer.byteLength(code) > LARGE_INLINE_BYTES) {
      emitDiagnostic({
        code: 'frontend.inlineScript.large',
        kind: 'html',
        stage: options.minify ? 'html.publish' : 'html.build',
        severity: 'warning',
        message: `Inline script ${recorded} is ${Math.round(Buffer.byteLength(code) / 1024)} KB; it is sent with every page that includes it.`,
        data: { source: recorded, bytes: Buffer.byteLength(code) },
        suggestion:
          'Keep pre-paint scripts small; move anything that can wait for the app bundle into it.',
      });
    }

    node.removeAttr('src');
    node.removeAttr('type');
    node.attr(INLINE_SCRIPT_ATTRIBUTE, recorded);
    node.text(code);
  }
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

async function bundleInlineScript(sourcePath: string, minify: boolean): Promise<string> {
  const result = await esbuild({
    entryPoints: [sourcePath],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    platform: 'browser',
    minify,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  const text = result.outputFiles[0]?.text ?? '';
  // A closing script tag inside the bundle would end the inline tag early.
  return text.trim().replace(/<\/script/gi, '<\\/script');
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}
