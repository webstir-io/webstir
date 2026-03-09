import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import ts from 'typescript';

import type { TestModule } from '../../../packages/tooling/webstir-testing/src/types.ts';
import { repoRoot } from './paths.ts';

const TESTING_PACKAGE_SPECIFIER = '@webstir-io/webstir-testing';

export async function compileTestModules(workspaceRoot: string, modules: readonly TestModule[]): Promise<void> {
  const shimPath = await ensureTestingRuntimeShim(workspaceRoot);

  await Promise.all(modules.map(async (module) => {
    if (!module.compiledPath) {
      return;
    }

    await mkdir(path.dirname(module.compiledPath), { recursive: true });

    if (module.sourcePath.endsWith('.js')) {
      const source = await readFile(module.sourcePath, 'utf8');
      const rewritten = rewriteTestingImports(source, module.compiledPath, shimPath);
      await writeFile(module.compiledPath, rewritten, 'utf8');
      return;
    }

    const source = await readFile(module.sourcePath, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: module.sourcePath,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        verbatimModuleSyntax: true,
        rewriteRelativeImportExtensions: true,
      },
      reportDiagnostics: false,
    });

    const rewritten = rewriteTestingImports(output.outputText, module.compiledPath, shimPath);
    await writeFile(module.compiledPath, rewritten, 'utf8');
  }));
}

async function ensureTestingRuntimeShim(workspaceRoot: string): Promise<string> {
  const shimPath = path.join(workspaceRoot, 'build', '.webstir', 'testing-runtime.mjs');
  const target = pathToFileURL(path.join(repoRoot, 'packages', 'tooling', 'webstir-testing', 'src', 'index.ts')).href;
  const contents = `export { test, assert } from ${JSON.stringify(target)};\n`;
  await mkdir(path.dirname(shimPath), { recursive: true });
  await writeFile(shimPath, contents, 'utf8');
  return shimPath;
}

function rewriteTestingImports(source: string, compiledPath: string, shimPath: string): string {
  const relativeShim = path.relative(path.dirname(compiledPath), shimPath).split(path.sep).join('/');
  const specifier = relativeShim.startsWith('.') ? relativeShim : `./${relativeShim}`;

  return source
    .replaceAll(`'${TESTING_PACKAGE_SPECIFIER}'`, `'${specifier}'`)
    .replaceAll(`"${TESTING_PACKAGE_SPECIFIER}"`, `"${specifier}"`);
}
