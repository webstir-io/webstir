import path from 'node:path';
import { load } from 'cheerio';
import type { Element } from 'domhandler';
import { pathExists, readFile } from '../utils/fs.js';
import {
  SOURCE_STAMP_ATTRIBUTE,
  formatStamp,
  hasBindingAttribute,
  isValidPartialName,
  mayContainBindings,
} from './bindings.js';
import { RenderTemplateError, type RenderIssue } from './issues.js';

export interface TemplateSourceOptions {
  readonly workspaceRoot: string;
  readonly partialsRoot: string;
}

interface SourceEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export async function prepareTemplateSource(
  html: string,
  filePath: string,
  options: TemplateSourceOptions,
): Promise<string> {
  if (!mayContainBindings(html)) {
    return html;
  }
  const issues: RenderIssue[] = [];
  const result = await expandSource(html, filePath, options, [], true, issues);
  if (issues.length > 0) {
    throw new RenderTemplateError(issues);
  }
  return result;
}

async function expandSource(
  html: string,
  filePath: string,
  options: TemplateSourceOptions,
  stack: readonly string[],
  isDocument: boolean,
  issues: RenderIssue[],
): Promise<string> {
  if (!mayContainBindings(html)) {
    return html;
  }

  const file = toWorkspacePath(options.workspaceRoot, filePath);
  const document = load(html, { sourceCodeLocationInfo: true }, isDocument);
  const edits: SourceEdit[] = [];
  let skipUntil = -1;

  for (const element of document('*').toArray() as Element[]) {
    const location = element.sourceCodeLocation;
    if (!location?.startTag || !hasBindingAttribute(element.attribs)) {
      continue;
    }
    if (location.startTag.startOffset < skipUntil) {
      continue;
    }

    const loc = { file, line: location.startTag.startLine };
    const tagEnd = location.startTag.startOffset + 1 + element.name.length;
    edits.push({
      start: tagEnd,
      end: tagEnd,
      text: ` ${SOURCE_STAMP_ATTRIBUTE}="${formatStamp(file, loc.line)}"`,
    });

    const partialName = element.attribs['data-include'];
    if (partialName === undefined) {
      continue;
    }

    const label = `data-include="${partialName}"`;
    if (!isValidPartialName(partialName)) {
      issues.push({ loc, message: `${label}: not a partial name` });
      continue;
    }
    if (element.attribs['data-text'] !== undefined) {
      issues.push({ loc, message: `${label}: cannot be combined with data-text` });
      continue;
    }
    if (!location.endTag) {
      issues.push({ loc, message: `${label}: <${element.name}> needs an explicit closing tag` });
      continue;
    }

    const partialPath = path.join(options.partialsRoot, `${partialName}.html`);
    if (stack.includes(partialPath) || partialPath === filePath) {
      const chain = [...stack, filePath, partialPath].map((entry) =>
        toWorkspacePath(options.workspaceRoot, entry),
      );
      issues.push({
        loc,
        message: `${label}: partials include each other (${chain.join(' -> ')})`,
      });
      continue;
    }
    if (!(await pathExists(partialPath))) {
      issues.push({
        loc,
        message: `${label}: ${toWorkspacePath(options.workspaceRoot, partialPath)} does not exist`,
      });
      continue;
    }

    const partialSource = await readFile(partialPath);
    const expanded = await expandSource(
      partialSource,
      partialPath,
      options,
      [...stack, filePath],
      false,
      issues,
    );
    edits.push({
      start: location.startTag.endOffset,
      end: location.endTag.startOffset,
      text: expanded,
    });
    skipUntil = location.endTag.startOffset;
  }

  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

function toWorkspacePath(workspaceRoot: string, filePath: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join('/');
}
