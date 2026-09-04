import path from 'node:path';
import { readFile } from 'node:fs/promises';

export async function resolveLocalCssDependencyGraph(entryPath: string): Promise<Set<string>> {
  const dependencies = new Set<string>();

  async function visit(filePath: string): Promise<void> {
    const resolvedPath = path.resolve(filePath);
    if (dependencies.has(resolvedPath)) return;

    dependencies.add(resolvedPath);
    const css = await readFile(resolvedPath, 'utf8');
    for (const importPath of findCssImportPaths(css)) {
      if (isLocalCssImport(importPath)) {
        await visit(path.resolve(path.dirname(resolvedPath), stripUrlSuffix(importPath)));
      }
    }
  }

  await visit(entryPath);
  return dependencies;
}

function findCssImportPaths(css: string): string[] {
  const imports: string[] = [];
  let index = 0;

  while (index < css.length) {
    if (css[index] === '/' && css[index + 1] === '*') {
      index = skipComment(css, index);
      continue;
    }
    if (css[index] === '"' || css[index] === "'") {
      index = skipQuotedValue(css, index);
      continue;
    }
    if (css[index] !== '@') {
      index += 1;
      continue;
    }

    const nameStart = index + 1;
    let nameEnd = nameStart;
    while (isIdentifierCharacter(css[nameEnd])) nameEnd += 1;
    if (css.slice(nameStart, nameEnd).toLowerCase() !== 'import') {
      index = nameEnd;
      continue;
    }

    const ruleEnd = findAtRuleEnd(css, nameEnd);
    const importPath = parseCssImportPath(css.slice(nameEnd, ruleEnd));
    if (importPath) imports.push(importPath);
    index = ruleEnd + 1;
  }

  return imports;
}

function findAtRuleEnd(css: string, start: number): number {
  let parentheses = 0;

  for (let index = start; index < css.length; index += 1) {
    if (css[index] === '/' && css[index + 1] === '*') {
      index = skipComment(css, index) - 1;
    } else if (css[index] === '"' || css[index] === "'") {
      index = skipQuotedValue(css, index) - 1;
    } else if (css[index] === '(') {
      parentheses += 1;
    } else if (css[index] === ')') {
      parentheses = Math.max(0, parentheses - 1);
    } else if (css[index] === ';' && parentheses === 0) {
      return index;
    }
  }

  return css.length;
}

function parseCssImportPath(params: string): string | null {
  const input = params.trim();
  if (!input) return null;

  if (input[0] === '"' || input[0] === "'") {
    return readQuotedValue(input, 0)?.value ?? null;
  }
  if (input.slice(0, 3).toLowerCase() !== 'url') return null;

  let openIndex = 3;
  while (isWhitespace(input[openIndex])) openIndex += 1;
  if (input[openIndex] !== '(') return null;

  const closeIndex = findFunctionEnd(input, openIndex);
  if (closeIndex === null) return null;

  const rawPath = input.slice(openIndex + 1, closeIndex).trim();
  if (rawPath[0] === '"' || rawPath[0] === "'") {
    return readQuotedValue(rawPath, 0)?.value ?? null;
  }
  return rawPath;
}

function readQuotedValue(input: string, start: number): { value: string; end: number } | null {
  const quote = input[start];
  let value = '';

  for (let index = start + 1; index < input.length; index += 1) {
    if (input[index] === '\\' && index + 1 < input.length) {
      value += input[index + 1];
      index += 1;
    } else if (input[index] === quote) {
      return { value, end: index + 1 };
    } else {
      value += input[index];
    }
  }

  return null;
}

function findFunctionEnd(input: string, openIndex: number): number | null {
  let depth = 0;

  for (let index = openIndex; index < input.length; index += 1) {
    if (input[index] === '"' || input[index] === "'") {
      index = skipQuotedValue(input, index) - 1;
    } else if (input[index] === '(') {
      depth += 1;
    } else if (input[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return null;
}

function skipComment(input: string, start: number): number {
  const end = input.indexOf('*/', start + 2);
  return end === -1 ? input.length : end + 2;
}

function skipQuotedValue(input: string, start: number): number {
  const quote = input[start];
  for (let index = start + 1; index < input.length; index += 1) {
    if (input[index] === '\\') index += 1;
    else if (input[index] === quote) return index + 1;
  }
  return input.length;
}

function isIdentifierCharacter(value: string | undefined): boolean {
  return value !== undefined && /[-_a-z0-9]/i.test(value);
}

function isWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t' || value === '\f';
}

function isLocalCssImport(importPath: string): boolean {
  return (
    importPath.length > 0 &&
    !importPath.startsWith('/') &&
    !importPath.startsWith('//') &&
    !importPath.startsWith('#') &&
    !importPath.startsWith('@') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(importPath)
  );
}

function stripUrlSuffix(importPath: string): string {
  const suffixIndex = importPath.search(/[?#]/);
  return suffixIndex === -1 ? importPath : importPath.slice(0, suffixIndex);
}
