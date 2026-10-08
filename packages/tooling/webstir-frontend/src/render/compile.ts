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
  WITH_BINDING_PREFIX,
  hasBindingAttribute,
  isBindingAttribute,
  parseEach,
  parsePath,
  parseStamp,
  parseWith,
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
  'srcset',
  'imagesrcset',
  'longdesc',
  'manifest',
]);
const ATTRIBUTE_NAME_PATTERN = /^[a-z_][a-z0-9_.:-]*$/;
const FORBIDDEN_ATTRIBUTES = new Set(['srcdoc', SOURCE_STAMP_ATTRIBUTE]);

/** What a name given by `data-with-<name>` stands for: a path, or text written in the template. */
type Given = { readonly path: RenderPath } | { readonly literal: string };

/** The names in reach of an element: each loop's item, and what `data-with-<name>` has given. */
interface Names {
  readonly scopes: readonly string[];
  readonly given: ReadonlyMap<string, Given>;
}

type Resolved =
  | { readonly path: RenderPath }
  | { readonly literal: string }
  | { readonly problem: string };

interface CompileState {
  readonly $: CheerioAPI;
  readonly source: string;
  readonly issues: RenderIssue[];
  readonly dynamic: Set<AnyNode>;
  /** Forms a submit control elsewhere in the document posts, through `form` and `formmethod`. */
  readonly postedForms: ReadonlySet<string>;
  bindings: number;
  /** The template gave a name with `data-with-<name>`, which no rendered page keeps. */
  settled: boolean;
}

export function compileRenderProgram(
  html: string,
  options: CompileRenderProgramOptions,
): RenderProgram {
  return compilePage(html, options).program;
}

/**
 * The page's program, and whether the template gave names with `data-with-<name>`: when such a
 * page leaves the server nothing to render, its HTML is what it compiled to.
 */
export function compilePage(
  html: string,
  options: CompileRenderProgramOptions,
): { readonly program: RenderProgram; readonly settled: boolean } {
  const $ = load(html);
  const postedForms = new Set(
    $('button[form][formmethod], input[form][formmethod]')
      .toArray()
      .filter((control) => isPost(control.attribs.formmethod))
      .map((control) => control.attribs.form!.trim()),
  );
  const state: CompileState = {
    $,
    source: options.source,
    issues: [],
    dynamic: new Set(),
    postedForms,
    bindings: 0,
    settled: false,
  };
  const roots = $.root().contents().toArray();
  for (const node of roots) {
    markDynamic(node, state);
  }

  const nodes: RenderNode[] = [];
  compileNodes(roots, nodes, { scopes: [], given: new Map() }, state);

  if (state.issues.length > 0) {
    throw new RenderTemplateError(state.issues);
  }
  return {
    program: {
      version: RENDER_PROGRAM_VERSION,
      page: options.page,
      source: options.source,
      bindings: state.bindings,
      nodes,
    },
    settled: state.settled,
  };
}

export function programNeedsRuntime(program: RenderProgram): boolean {
  return program.nodes.some((node) => typeof node !== 'string');
}

function markDynamic(node: AnyNode, state: CompileState): boolean {
  if (!isElement(node)) {
    return false;
  }
  let result = hasBindingAttribute(node.attribs) || isPostForm(node, state);
  for (const child of node.children) {
    if (markDynamic(child, state)) {
      result = true;
    }
  }
  if (result) {
    state.dynamic.add(node);
  }
  return result;
}

function compileNodes(
  nodes: readonly AnyNode[],
  target: RenderNode[],
  names: Names,
  state: CompileState,
): void {
  for (const node of nodes) {
    if (isElement(node) && state.dynamic.has(node)) {
      compileElement(node, target, names, state);
    } else {
      pushStatic(target, state.$.html(node));
    }
  }
}

function compileElement(
  element: Element,
  target: RenderNode[],
  names: Names,
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

  /** A path as written, or undefined after reporting why it cannot be used here. */
  const pathOf = (attribute: string, source: string, keys: string[], within: Names) => {
    const resolved = resolve(source, keys, within);
    if ('path' in resolved) return resolved.path;
    report(
      attribute,
      'problem' in resolved ? resolved.problem : `\`${keys[0]}\` is text, and this needs data`,
    );
    return undefined;
  };

  let container = target;
  let inner = names;

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
      const path = pathOf('data-each', parsed.source, parsed.path, names);
      if (path) {
        const body: RenderNode[] = [];
        target.push({ op: 'each', as: parsed.as, path, loc, body });
        state.bindings += 1;
        container = body;
      }
      // The loop's item is the nearest thing by that name, over one given further out.
      const given = new Map(names.given);
      given.delete(parsed.as);
      inner = { scopes: [...names.scopes, parsed.as], given };
    }
  }

  // Each name is given from what is in reach outside this element, so none reads another.
  const given = new Map(inner.given);
  for (const [name, value] of Object.entries(attribs)) {
    if (!name.startsWith(WITH_BINDING_PREFIX)) {
      continue;
    }
    // Its attribute is the template's alone, so the page is written as what it compiled to.
    state.settled = true;
    const parsed = parseWith(name.slice(WITH_BINDING_PREFIX.length), value);
    if (typeof parsed === 'string') {
      report(name, parsed);
      continue;
    }
    if ('literal' in parsed) {
      given.set(parsed.name, { literal: parsed.literal });
      continue;
    }
    const resolved = resolve(value.trim(), parsed.path, inner);
    if ('problem' in resolved) {
      report(name, resolved.problem);
    } else {
      given.set(parsed.name, resolved);
    }
  }
  inner = { scopes: inner.scopes, given };

  const ifValue = attribs['data-if'];
  if (ifValue !== undefined) {
    const negate = ifValue.trim().startsWith('!');
    const source = negate ? ifValue.trim().slice(1).trim() : ifValue.trim();
    const parsed = parsePath(source);
    if (typeof parsed === 'string') {
      report('data-if', parsed);
    } else {
      const resolved = resolve(source, parsed, inner);
      if ('problem' in resolved) {
        report('data-if', resolved.problem);
      } else if ('literal' in resolved) {
        // Text written in the template is known now: empty text is falsy, as it is in data.
        if (resolved.literal.length > 0 === negate) {
          return;
        }
      } else {
        const body: RenderNode[] = [];
        container.push({ op: 'if', negate, path: resolved.path, loc, body });
        state.bindings += 1;
        container = body;
      }
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
    const resolved = resolve(value.trim(), parsed, inner);
    if ('problem' in resolved) {
      report(name, resolved.problem);
      continue;
    }
    boundAttributes.add(target);
    if ('literal' in resolved) {
      attributeOps.push(` ${target}="${escapeAttribute(resolved.literal)}"`);
      continue;
    }
    attributeOps.push({
      op: 'attr',
      name: target,
      url: URL_ATTRIBUTES.has(target) || (element.name === 'object' && target === 'data'),
      path: resolved.path,
      loc,
    });
    state.bindings += 1;
  }

  const propsValue = attribs['data-props'];
  if (propsValue !== undefined) {
    const parsed = parsePath(propsValue);
    if (attribs['data-island'] === undefined) {
      report('data-props', 'passes data to an island; add data-island="<name>" to this element');
    } else if (typeof parsed === 'string') {
      report('data-props', parsed);
    } else {
      const path = pathOf('data-props', propsValue.trim(), parsed, inner);
      if (path) {
        // Rendered into its own attribute, so a rendered page never reads as a template again.
        attributeOps.push({
          op: 'attr',
          name: 'data-island-props',
          url: false,
          json: true,
          path,
          loc,
        });
        state.bindings += 1;
      }
    }
  }

  pushStatic(container, `<${element.name}${renderStaticAttributes(element, boundAttributes)}`);
  for (const op of attributeOps) {
    if (typeof op === 'string') pushStatic(container, op);
    else container.push(op);
  }
  pushStatic(container, '>');

  const textValue = attribs['data-text'];
  if (VOID_ELEMENTS.has(element.name)) {
    if (textValue !== undefined) {
      report('data-text', `<${element.name}> has no content to replace`);
    }
    return;
  }

  if (isPostForm(element, state)) {
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
      const resolved = resolve(textValue.trim(), parsed, inner);
      if ('problem' in resolved) {
        report('data-text', resolved.problem);
      } else if ('literal' in resolved) {
        pushStatic(container, escapeText(resolved.literal));
      } else {
        container.push({ op: 'text', path: resolved.path, loc });
        state.bindings += 1;
      }
    }
  } else {
    compileNodes(element.children, container, inner, state);
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
  // Whether a form posts decides its CSRF field at build time, so what makes it post is written.
  if (element.name === 'form' && name === 'method') {
    return 'form method must be written in the HTML';
  }
  if (name === 'formmethod') {
    return 'formmethod must be written in the HTML';
  }
  if (name === 'form' && isSubmitControl(element)) {
    return 'the form a submit control posts must be written in the HTML';
  }
  return undefined;
}

function isSubmitControl(element: Element): boolean {
  const type = (element.attribs.type ?? '').trim().toLowerCase();
  return (
    element.name === 'button' ||
    (element.name === 'input' && (type === 'submit' || type === 'image'))
  );
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

/** What a path as written reads: a given name stands for its path or text, nearest first. */
function resolve(source: string, keys: string[], names: Names): Resolved {
  const given = names.given.get(keys[0]);
  if (given && 'literal' in given) {
    return keys.length === 1
      ? given
      : { problem: `\`${keys[0]}\` is text, so it has no \`${keys[1]}\`` };
  }
  if (given) {
    return {
      path: { source, scope: given.path.scope, keys: [...given.path.keys, ...keys.slice(1)] },
    };
  }
  const scope = names.scopes.lastIndexOf(keys[0]);
  return {
    path: scope >= 0 ? { source, scope, keys: keys.slice(1) } : { source, scope: -1, keys },
  };
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

/**
 * A form that posts: by its own method, or through a submit control's `formmethod`, whether the
 * control sits inside it or names it with `form` from elsewhere.
 */
function isPostForm(element: Element, state: CompileState): boolean {
  if (element.name !== 'form') {
    return false;
  }
  const id = element.attribs.id?.trim();
  return (
    isPost(element.attribs.method) ||
    hasPostSubmitter(element.children, id) ||
    (id !== undefined && state.postedForms.has(id))
  );
}

/** A descendant submitter posts this form unless its `form` attribute names another. */
function hasPostSubmitter(nodes: readonly AnyNode[], formId: string | undefined): boolean {
  return nodes.some(
    (node) =>
      isElement(node) &&
      ((['button', 'input'].includes(node.name) &&
        isPost(node.attribs.formmethod) &&
        (node.attribs.form === undefined || node.attribs.form.trim() === formId)) ||
        hasPostSubmitter(node.children, formId)),
  );
}

function isPost(method: string | undefined): boolean {
  return (method ?? '').trim().toLowerCase() === 'post';
}

function isElement(node: AnyNode): node is Element {
  return node.type === 'tag' || node.type === 'script' || node.type === 'style';
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');
}
