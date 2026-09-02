import path from 'node:path';
import { realpath } from 'node:fs/promises';
import postcss from 'postcss';
import { pathExists, readFile } from '../utils/fs.js';

interface ParsedCssImport {
  path: string;
  qualifiers: string;
}

type CssImportResolver = (importPath: string, containingPath: string) => string | null;

export async function inlineSourceAppImports(
  css: string,
  sourcePath: string,
  stylesRoot: string,
): Promise<string> {
  return inlineCssImports(css, sourcePath, stylesRoot, (importPath, containingPath) => {
    if (!isLocalCssImport(importPath)) {
      return null;
    }
    return path.resolve(path.dirname(containingPath), stripUrlSuffix(importPath));
  });
}

export async function inlineCssImports(
  css: string,
  containingPath: string,
  permittedRoot: string,
  resolveImport: CssImportResolver,
  importStack: string[] = [],
): Promise<string> {
  const canonicalRoot = await realpath(permittedRoot);
  const canonicalContaining = (await pathExists(containingPath))
    ? await realpath(containingPath)
    : await canonicalizePotentialPath(containingPath);
  const stack = importStack.length > 0 ? importStack : [canonicalContaining];
  const root = postcss.parse(css, { from: containingPath });
  const imports: postcss.AtRule[] = [];
  root.walkAtRules('import', (rule) => {
    imports.push(rule);
  });

  for (const rule of imports) {
    const parsed = parseCssImport(rule.params);
    if (!parsed) {
      continue;
    }
    const resolved = resolveImport(parsed.path, canonicalContaining);
    if (!resolved) {
      continue;
    }
    if (!(await pathExists(resolved))) {
      throw new Error(`Unable to resolve local CSS @import: ${parsed.path} from ${containingPath}`);
    }

    const canonicalImport = await realpath(resolved);
    if (!isWithinOrEqual(canonicalImport, canonicalRoot)) {
      throw new Error(
        `CSS @import escapes the permitted stylesheet root: ${parsed.path} from ${containingPath}`,
      );
    }
    if (stack.includes(canonicalImport)) {
      const cycle = [...stack, canonicalImport].map((file) => path.basename(file)).join(' -> ');
      throw new Error(`Circular CSS @import detected: ${cycle}`);
    }

    const importedCss = await inlineCssImports(
      await readFile(canonicalImport),
      canonicalImport,
      canonicalRoot,
      resolveImport,
      [...stack, canonicalImport],
    );
    const importedRoot = postcss.parse(importedCss, { from: canonicalImport });
    importedRoot.walkAtRules('charset', (charset) => {
      charset.remove();
    });
    rebaseRelativeUrls(importedRoot, canonicalImport, canonicalContaining);
    rule.replaceWith(...applyCssImportQualifiers(importedRoot.nodes, parsed.qualifiers));
  }

  return root.toString();
}

async function canonicalizePotentialPath(filePath: string): Promise<string> {
  let existingAncestor = path.dirname(path.resolve(filePath));
  let suffix = path.basename(filePath);

  while (!(await pathExists(existingAncestor))) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    suffix = path.join(path.basename(existingAncestor), suffix);
    existingAncestor = parent;
  }

  return path.join(await realpath(existingAncestor), suffix);
}

function rebaseRelativeUrls(
  root: postcss.Root,
  importedPath: string,
  containingPath: string,
): void {
  root.walkDecls((declaration) => {
    declaration.value = rewriteCssUrls(declaration.value, importedPath, containingPath);
  });
  root.walkAtRules((rule) => {
    if (rule.name.toLowerCase() !== 'import') {
      rule.params = rewriteCssUrls(rule.params, importedPath, containingPath);
    }
  });
}

function rewriteCssUrls(value: string, importedPath: string, containingPath: string): string {
  let result = '';
  let cursor = 0;
  let scanIndex = 0;

  while (scanIndex < value.length) {
    const functionMatch = findNextCssUrlFunction(value, scanIndex);
    if (!functionMatch) {
      result += value.slice(cursor);
      break;
    }

    const { functionStart, openIndex } = functionMatch;
    const parsed = readCssFunction(value, openIndex);
    if (!parsed) {
      result += value.slice(cursor);
      break;
    }

    result += value.slice(cursor, functionStart);
    const rawValue = parsed.value;
    const leadingWhitespace = rawValue.match(/^\s*/)?.[0] ?? '';
    const trailingWhitespace = rawValue.match(/\s*$/)?.[0] ?? '';
    const trimmed = rawValue.trim();
    const quote = trimmed[0] === '"' || trimmed[0] === "'" ? trimmed[0] : '';
    const url = quote && trimmed.endsWith(quote) ? trimmed.slice(1, -1) : trimmed;

    if (!isRebasableAssetUrl(url)) {
      result += value.slice(functionStart, parsed.end);
    } else {
      const suffixIndex = url.search(/[?#]/);
      const pathname = suffixIndex === -1 ? url : url.slice(0, suffixIndex);
      const suffix = suffixIndex === -1 ? '' : url.slice(suffixIndex);
      const absoluteAssetPath = path.resolve(path.dirname(importedPath), pathname);
      let rebased = normalizeForwardSlashes(
        path.relative(path.dirname(containingPath), absoluteAssetPath),
      );
      if (!rebased.startsWith('.')) {
        rebased = `./${rebased}`;
      }
      result += `url(${leadingWhitespace}${quote}${rebased}${suffix}${quote}${trailingWhitespace})`;
    }
    cursor = parsed.end;
    scanIndex = parsed.end;
  }

  return result;
}

function findNextCssUrlFunction(
  value: string,
  startIndex: number,
): { functionStart: number; openIndex: number } | null {
  let quote: string | null = null;

  for (let index = startIndex; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '/' && value[index + 1] === '*') {
      const commentEnd = value.indexOf('*/', index + 2);
      if (commentEnd === -1) return null;
      index = commentEnd + 1;
      continue;
    }
    if (value.slice(index, index + 3).toLowerCase() !== 'url') continue;

    const previous = value[index - 1];
    if (previous && /[-_a-z0-9]/i.test(previous)) continue;
    let openIndex = index + 3;
    while (isWhitespace(value[openIndex])) openIndex += 1;
    if (value[openIndex] === '(') return { functionStart: index, openIndex };
  }

  return null;
}

function isRebasableAssetUrl(url: string): boolean {
  return (
    url.length > 0 &&
    !url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.startsWith('#') &&
    !url.startsWith('?') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(url)
  );
}

function normalizeForwardSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

export function parseCssImport(params: string): ParsedCssImport | null {
  const input = params.trim();
  if (!input) return null;

  const quote = input[0];
  if (quote === '"' || quote === "'") {
    const quoted = readCssQuotedValue(input, 0);
    return quoted ? { path: quoted.value, qualifiers: input.slice(quoted.end).trim() } : null;
  }
  if (input.slice(0, 3).toLowerCase() !== 'url') return null;

  let openIndex = 3;
  while (isWhitespace(input[openIndex])) openIndex += 1;
  if (input[openIndex] !== '(') return null;

  const urlFunction = readCssFunction(input, openIndex);
  if (!urlFunction) return null;
  const rawPath = urlFunction.value.trim();
  const quoted = readCssQuotedValue(rawPath, 0);
  const importPath = quoted && quoted.end === rawPath.length ? quoted.value : rawPath;
  return { path: importPath, qualifiers: input.slice(urlFunction.end).trim() };
}

export function serializeCssImport(importPath: string, qualifiers: string): string {
  const escaped = importPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"${qualifiers ? ` ${qualifiers}` : ''}`;
}

function readCssQuotedValue(input: string, start: number): { value: string; end: number } | null {
  const quote = input[start];
  if (quote !== '"' && quote !== "'") return null;

  let value = '';
  for (let index = start + 1; index < input.length; index += 1) {
    const character = input[index];
    if (character === '\\' && index + 1 < input.length) {
      value += input[index + 1];
      index += 1;
    } else if (character === quote) {
      return { value, end: index + 1 };
    } else {
      value += character;
    }
  }
  return null;
}

function readCssFunction(input: string, openIndex: number): { value: string; end: number } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openIndex; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) return { value: input.slice(openIndex + 1, index), end: index + 1 };
    }
  }
  return null;
}

function applyCssImportQualifiers(
  importedNodes: postcss.ChildNode[],
  qualifiers: string,
): postcss.ChildNode[] {
  let remaining = qualifiers.trim();
  let layer: string | null | undefined;
  let supports: string | undefined;

  const layerFunction = consumeQualifierFunction(remaining, 'layer');
  if (layerFunction) {
    layer = layerFunction.value.trim();
    remaining = layerFunction.remaining;
  } else if (/^layer(?:\s|$)/i.test(remaining)) {
    layer = null;
    remaining = remaining.slice('layer'.length).trim();
  }
  const supportsFunction = consumeQualifierFunction(remaining, 'supports');
  if (supportsFunction) {
    supports = supportsFunction.value.trim();
    remaining = supportsFunction.remaining;
  }

  let nodes = importedNodes;
  if (remaining) nodes = [wrapCssNodes('media', remaining, nodes)];
  if (supports !== undefined) {
    const condition = /^(?:--)?[-_a-z][-_a-z0-9]*\s*:/i.test(supports) ? `(${supports})` : supports;
    nodes = [wrapCssNodes('supports', condition, nodes)];
  }
  if (layer !== undefined) nodes = [wrapCssNodes('layer', layer ?? '', nodes)];
  return nodes;
}

function consumeQualifierFunction(
  input: string,
  name: string,
): { value: string; remaining: string } | null {
  if (input.slice(0, name.length).toLowerCase() !== name) return null;
  let openIndex = name.length;
  while (isWhitespace(input[openIndex])) openIndex += 1;
  if (input[openIndex] !== '(') return null;
  const parsed = readCssFunction(input, openIndex);
  return parsed ? { value: parsed.value, remaining: input.slice(parsed.end).trim() } : null;
}

function wrapCssNodes(name: string, params: string, nodes: postcss.ChildNode[]): postcss.AtRule {
  const wrapper = postcss.atRule({ name, params });
  wrapper.append(...nodes);
  return wrapper;
}

function isWhitespace(value: string | undefined): boolean {
  return value === ' ' || value === '\n' || value === '\r' || value === '\t' || value === '\f';
}

export function isLocalCssImport(importPath: string): boolean {
  return (
    importPath.length > 0 &&
    !importPath.startsWith('/') &&
    !importPath.startsWith('//') &&
    !importPath.startsWith('#') &&
    !importPath.startsWith('@') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(importPath)
  );
}

export function stripUrlSuffix(importPath: string): string {
  const suffixIndex = importPath.search(/[?#]/);
  return suffixIndex === -1 ? importPath : importPath.slice(0, suffixIndex);
}

export function isWithinOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}
