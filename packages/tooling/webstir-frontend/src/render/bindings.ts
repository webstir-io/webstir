export const SOURCE_STAMP_ATTRIBUTE = 'data-webstir-src';
export const ATTR_BINDING_PREFIX = 'data-attr-';

export const BINDING_ATTRIBUTES = ['data-text', 'data-if', 'data-each', 'data-include'] as const;

const BINDING_PATTERN = /\sdata-(?:text|if|each|include|attr-[^\s=>]+)\s*=/i;
const SEGMENT_PATTERN = /^[A-Za-z_$][\w$]*$/;
const EACH_PATTERN = /^(\S+)\s+as\s+(\S+)$/;
const PARTIAL_NAME_PATTERN = /^[A-Za-z0-9][\w-]*(?:\/[A-Za-z0-9][\w-]*)*$/;

export function mayContainBindings(html: string): boolean {
  return BINDING_PATTERN.test(html);
}

export function isBindingAttribute(name: string): boolean {
  return (
    (BINDING_ATTRIBUTES as readonly string[]).includes(name) ||
    name.startsWith(ATTR_BINDING_PREFIX) ||
    name === SOURCE_STAMP_ATTRIBUTE
  );
}

export function hasBindingAttribute(attribs: Record<string, string>): boolean {
  return Object.keys(attribs).some(isBindingAttribute);
}

export function parsePath(value: string): string[] | string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return 'expected a path';
  }
  const segments = trimmed.split('.');
  for (const segment of segments) {
    if (!SEGMENT_PATTERN.test(segment)) {
      return `\`${trimmed}\` is not a path; use names joined by dots, like \`client.name\``;
    }
  }
  return segments;
}

export function parseEach(value: string): { source: string; path: string[]; as: string } | string {
  const match = EACH_PATTERN.exec(value.trim());
  if (!match) {
    return 'expected `items as item`';
  }
  const path = parsePath(match[1]);
  if (typeof path === 'string') {
    return path;
  }
  if (!SEGMENT_PATTERN.test(match[2])) {
    return `\`${match[2]}\` is not a valid name`;
  }
  return { source: match[1], path, as: match[2] };
}

export function isValidPartialName(value: string): boolean {
  return PARTIAL_NAME_PATTERN.test(value);
}

export function formatStamp(file: string, line: number): string {
  return `${file}:${line}`;
}

export function parseStamp(value: string | undefined): { file: string; line: number } | undefined {
  if (!value) {
    return undefined;
  }
  const separator = value.lastIndexOf(':');
  const line = Number(value.slice(separator + 1));
  if (separator <= 0 || !Number.isInteger(line) || line < 1) {
    return undefined;
  }
  return { file: value.slice(0, separator), line };
}
