import type { RenderSourceLocation } from '@webstir-io/module-contract';

export interface RenderIssue {
  readonly loc: RenderSourceLocation;
  readonly message: string;
}

export class RenderTemplateError extends Error {
  readonly issues: readonly RenderIssue[];

  constructor(issues: readonly RenderIssue[]) {
    const unique = uniqueIssues(issues);
    super(formatRenderIssues(unique));
    this.name = 'RenderTemplateError';
    this.issues = unique;
  }
}

/** A partial used in several places reports each problem once. */
function uniqueIssues(issues: readonly RenderIssue[]): RenderIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.loc.file}:${issue.loc.line}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function formatRenderIssues(issues: readonly RenderIssue[]): string {
  const lines = issues.map((issue) => `${issue.loc.file}:${issue.loc.line}: ${issue.message}`);
  const noun = issues.length === 1 ? 'error' : 'errors';
  return `Template ${noun}:\n${lines.join('\n')}`;
}
