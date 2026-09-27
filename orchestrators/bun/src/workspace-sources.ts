import { readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from '@typescript/typescript6';

export const SCRIPT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
]);

const BUILD_OUTPUT = new Set(['dist', 'build', 'coverage']);

/**
 * Every regular file in the workspace, skipping dependencies, the workspace's build output,
 * hidden folders and symbolic links.
 */
export async function workspaceFiles(root: string): Promise<string[]> {
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
export function scriptSpecifiers(text: string, filePath: string): string[] {
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

/** The files a script names in `/// <reference path="..." />` directives. */
export function scriptReferencedFiles(text: string): string[] {
  return ts.preProcessFile(text, false, false).referencedFiles.map((entry) => entry.fileName);
}

/** A tsconfig's text as JSON, comments and trailing commas allowed; undefined when unreadable. */
export function parseTsconfigText(text: string, filePath: string): unknown {
  const parsed = ts.parseConfigFileTextToJson(filePath, text);
  return parsed.error ? undefined : parsed.config;
}
