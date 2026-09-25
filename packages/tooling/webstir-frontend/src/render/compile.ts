import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import {
  RENDER_PROGRAM_VERSION,
  type RenderNode,
  type RenderPath,
  type RenderProgram,
  type RenderSourceLocation,
} from '@webstir-io/module-contract';
import {
  ATTR_BINDING_PREFIX,
  SOURCE_STAMP_ATTRIBUTE,
  hasBindingAttribute,
  isBindingAttribute,
  parseEach,
  parsePath,
  parseStamp,
} from './bindings.js';
import { RenderTemplateError, type RenderIssue } from './issues.js';

export interface CompileRenderProgramOptions {
  readonly page: string;
  readonly source: string;
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'xmp']);
// Every document keeps these; <main> is also what client navigation swaps between pages.
const DOCUMENT_ELEMENTS = new Set(['html', 'head', 'body', 'main']);
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'cite',
  'poster',
  'background',
  'ping',
  'xlink:href',
]);
const ATTRIBUTE_NAME_PATTERN = /^[a-z_][a-z0-9_.:-]*$/;
const FORBIDDEN_ATTRIBUTES = new Set(['srcdoc', SOURCE_STAMP_ATTRIBUTE]);

interface CompileState {
  readonly $: CheerioAPI;
  readonly source: string;
  readonly issues: RenderIssue[];
  readonly dynamic: Set<AnyNode>;
  bindings: number;
}

export function compileRenderProgram(
  html: string,
  options: CompileRenderProgramOptions,
): RenderProgram {
  const $ = load(html);
  const state: CompileState = {
    $,
    source: options.source,
    issues: [],
    dynamic: new Set(),
    bindings: 0,
  };
  const roots = $.root().contents().toArray();
  for (const node of roots) {
    markDynamic(node, state.dynamic);
  }

  const nodes: RenderNode[] = [];
  compileNodes(roots, nodes, [], state);

  if (state.issues.length > 0) {
    throw new RenderTemplateError(state.issues);
  }
  return {
    version: RENDER_PROGRAM_VERSION,
    page: options.page,
    source: options.source,
    bindings: state.bindings,
    nodes,
  };
}

export function programNeedsRuntime(program: RenderProgram): boolean {
  return program.nodes.some((node) => typeof node !== 'string');
}

function markDynamic(node: AnyNode, dynamic: Set<AnyNode>): boolean {
  if (!isElement(node)) {
    return false;
  }
  let result = hasBindingAttribute(node.attribs) || isPostForm(node);
  for (const child of node.children) {
    if (markDynamic(child, dynamic)) {
      result = true;
    }
  }
  if (result) {
    dynamic.add(node);
  }
  return result;
}

function compileNodes(
  nodes: readonly AnyNode[],
  target: RenderNode[],
  scopes: readonly string[],
  state: CompileState,
): void {
  for (const node of nodes) {
    if (isElement(node) && state.dynamic.has(node)) {
      compileElement(node, target, scopes, state);
    } else {
      pushStatic(target, state.$.html(node));
    }
  }
}

function compileElement(
  element: Element,
  target: RenderNode[],
  scopes: readonly string[],
  state: CompileState,
): void {
  const attribs = element.attribs;
  const loc: RenderSourceLocation = parseStamp(attribs[SOURCE_STAMP_ATTRIBUTE]) ?? {
    file: state.source,
    line: 1,
  };
  const report = (attribute: string, message: string) => {
    state.issues.push({ loc, message: `${attribute}="${attribs[attribute]}": ${message}` });
  };

  let container = target;
  let innerScopes = scopes;

  if (attribs['data-each'] !== undefined || attribs['data-if'] !== undefined) {
    if (DOCUMENT_ELEMENTS.has(element.name)) {
      const attribute = attribs['data-each'] !== undefined ? 'data-each' : 'data-if';
      report(
        attribute,
        `not allowed on <${element.name}>, which every page keeps; put it on an element inside`,
      );
    }
  }

  const eachValue = attribs['data-each'];
  if (eachValue !== undefined) {
    const parsed = parseEach(eachValue);
    if (typeof parsed === 'string') {
      report('data-each', parsed);
    } else {
      const body: RenderNode[] = [];
      target.push({
        op: 'each',
        as: parsed.as,
        path: resolvePath(parsed.source, parsed.path, scopes),
        loc,
        body,
      });
      state.bindings += 1;
      container = body;
      innerScopes = [...scopes, parsed.as];
    }
  }

  const ifValue = attribs['data-if'];
  if (ifValue !== undefined) {
    const negate = ifValue.trim().startsWith('!');
    const source = negate ? ifValue.trim().slice(1).trim() : ifValue.trim();
    const parsed = parsePath(source);
    if (typeof parsed === 'string') {
      report('data-if', parsed);
    } else {
      const body: RenderNode[] = [];
      container.push({
        op: 'if',
        negate,
        path: resolvePath(source, parsed, innerScopes),
        loc,
        body,
      });
      state.bindings += 1;
      container = body;
    }
  }

  const boundAttributes = new Set<string>();
  const attributeOps: RenderNode[] = [];
  for (const [name, value] of Object.entries(attribs)) {
    if (!name.startsWith(ATTR_BINDING_PREFIX)) {
      continue;
    }
    const target = name.slice(ATTR_BINDING_PREFIX.length);
    const problem = checkBoundAttributeName(target, element);
    if (problem) {
      report(name, problem);
      continue;
    }
    const parsed = parsePath(value);
    if (typeof parsed === 'string') {
      report(name, parsed);
      continue;
    }
    boundAttributes.add(target);
    attributeOps.push({
      op: 'attr',
      name: target,
      url: URL_ATTRIBUTES.has(target),
      path: resolvePath(value.trim(), parsed, innerScopes),
      loc,
    });
    state.bindings += 1;
  }

  pushStatic(container, `<${element.name}${renderStaticAttributes(element, boundAttributes)}`);
  for (const op of attributeOps) {
    container.push(op);
  }
  pushStatic(container, '>');

  const textValue = attribs['data-text'];
  if (VOID_ELEMENTS.has(element.name)) {
    if (textValue !== undefined) {
      report('data-text', `<${element.name}> has no content to replace`);
    }
    return;
  }

  if (isPostForm(element)) {
    container.push({ op: 'csrf' });
  }

  if (textValue !== undefined) {
    const parsed = parsePath(textValue);
    if (RAW_TEXT_ELEMENTS.has(element.name)) {
      report('data-text', `not allowed on <${element.name}>`);
    } else if (element.children.some((child) => state.dynamic.has(child))) {
      report('data-text', 'replaces the element content, so bindings inside it would never render');
    } else if (typeof parsed === 'string') {
      report('data-text', parsed);
    } else {
      container.push({ op: 'text', path: resolvePath(textValue.trim(), parsed, innerScopes), loc });
      state.bindings += 1;
    }
  } else {
    compileNodes(element.children, container, innerScopes, state);
  }

  pushStatic(container, `</${element.name}>`);
}

function checkBoundAttributeName(name: string, element: Element): string | undefined {
  if (!ATTRIBUTE_NAME_PATTERN.test(name)) {
    return 'not a valid attribute name';
  }
  if (name.startsWith('on')) {
    return 'event handler attributes cannot be bound';
  }
  if (FORBIDDEN_ATTRIBUTES.has(name) || isBindingAttribute(name)) {
    return `\`${name}\` cannot be bound`;
  }
  if (element.name === 'form' && name === 'method') {
    return 'form method must be written in the HTML';
  }
  return undefined;
}

function renderStaticAttributes(element: Element, bound: ReadonlySet<string>): string {
  let output = '';
  for (const [name, value] of Object.entries(element.attribs)) {
    if (isBindingAttribute(name) || bound.has(name)) {
      continue;
    }
    output += ` ${name}="${escapeAttribute(value)}"`;
  }
  return output;
}

function resolvePath(source: string, keys: string[], scopes: readonly string[]): RenderPath {
  const scope = scopes.lastIndexOf(keys[0]);
  if (scope >= 0) {
    return { source, scope, keys: keys.slice(1) };
  }
  return { source, scope: -1, keys };
}

function pushStatic(target: RenderNode[], html: string): void {
  if (html.length === 0) {
    return;
  }
  const last = target.length - 1;
  if (last >= 0 && typeof target[last] === 'string') {
    target[last] = `${target[last] as string}${html}`;
    return;
  }
  target.push(html);
}

function isPostForm(element: Element): boolean {
  return element.name === 'form' && (element.attribs.method ?? '').trim().toLowerCase() === 'post';
}

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');
}
