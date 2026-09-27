import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from '@typescript/typescript6';

import { findCssImportPaths } from './css-import-graph.ts';
import type { PackagedFeature } from './feature-imports.ts';

const SCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.cts']);

/**
 * Files anywhere in the workspace (app code, tests, tooling) that would still use one of a
 * feature's copies once the app entry and app.css are rewritten (`rewritten` holds those new
 * contents). A relative import is resolved against the copies' paths; any other import ending in a
 * copy's name (a path alias) counts too, since it cannot be resolved here. An HTML file counts if
 * it names a copy's path at all. Dependencies, the workspace's build output and hidden folders are
 * skipped.
 */
export async function findCopyReferences(
  workspaceRoot: string,
  feature: PackagedFeature,
  rewritten: ReadonlyMap<string, string>,
): Promise<string[]> {
  const appRoot = path.join(workspaceRoot, 'src', 'frontend', 'app');
  const copies = new Set(feature.copies.map((copy) => withoutExtension(path.join(appRoot, copy))));
  const copyNames = feature.copies.map((copy) => path.basename(withoutExtension(copy)));

  const found: string[] = [];
  for (const filePath of await workspaceFiles(workspaceRoot)) {
    const extension = path.extname(filePath);
    if (copies.has(withoutExtension(filePath))) continue;
    const isScript = SCRIPT_EXTENSIONS.has(extension);
    if (!isScript && extension !== '.css' && extension !== '.html') continue;
    const text = rewritten.get(filePath) ?? (await readFile(filePath, 'utf8'));
    if (extension === '.html') {
      if (feature.copies.some((copy) => text.includes(withoutExtension(copy)))) {
        found.push(relativePath(workspaceRoot, filePath));
      }
      continue;
    }
    const specifiers = isScript ? scriptSpecifiers(text, filePath) : findCssImportPaths(text);
    const packaged = new Set([feature.script.packaged, feature.style?.packaged]);
    const usesCopy = specifiers.some((specifier) => {
      if (packaged.has(specifier)) return false;
      const bare = specifier.replace(/[?#].*$/, '');
      if (bare.startsWith('.')) {
        return copies.has(withoutExtension(path.resolve(path.dirname(filePath), bare)));
      }
      const name = path.basename(withoutExtension(bare));
      return copyNames.includes(name) && !/^[a-z][a-z0-9+.-]*:/i.test(specifier);
    });
    if (usesCopy) {
      found.push(relativePath(workspaceRoot, filePath));
    }
  }
  return found;
}

function relativePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join('/');
}

const BUILD_OUTPUT = new Set(['dist', 'build', 'coverage']);

async function workspaceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      if (directory === root && BUILD_OUTPUT.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  };
  await walk(root);
  return files;
}

/**
 * Every module a script names, from TypeScript's syntax tree, so regexes, comments and strings are
 * read exactly: imports and re-exports (type-only included), import types, import() and require()
 * calls, and `import x = require()`.
 */
function scriptSpecifiers(text: string, filePath: string): string[] {
  const kind = /\.[jt]sx$/.test(filePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, false, kind);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const literal = node.argument.literal;
      if (ts.isStringLiteralLike(literal)) specifiers.push(literal.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function withoutExtension(filePath: string): string {
  return filePath.replace(/\.(?:[cm]?[jt]sx?|css)$/, '');
}
