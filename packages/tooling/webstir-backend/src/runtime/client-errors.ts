// The browser-side reporter in the scaffold posts uncaught errors to
// POST /client-errors. Both the dev server and the backend runtime accept them
// with the same contract: JSON only, at most 32 KB, 204 when taken, 415 or
// 413 when refused. An unreadable body is taken and dropped, as the reporter
// is fire-and-forget and a retry would only repeat the noise.

export const CLIENT_ERRORS_PATH = '/client-errors';
export const CLIENT_ERROR_MAX_BYTES = 32 * 1024;

export interface ClientErrorReport {
  readonly type: string;
  readonly message: string;
  readonly stack: string;
  readonly filename: string;
  readonly lineno: number;
  readonly colno: number;
  readonly pageUrl: string;
  readonly userAgent: string;
  readonly timestamp: string;
  readonly correlationId: string;
}

export type ClientErrorOutcome =
  | { readonly status: 204; readonly report: ClientErrorReport | null }
  | { readonly status: 413 | 415; readonly report: null };

export function isClientErrorsPath(pathname: string): boolean {
  return pathname === CLIENT_ERRORS_PATH;
}

export async function readClientErrorReport(request: Request): Promise<ClientErrorOutcome> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.trim().toLowerCase().startsWith('application/json')) {
    return { status: 415, report: null };
  }

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > CLIENT_ERROR_MAX_BYTES) {
    return { status: 413, report: null };
  }

  const body = await readBodyWithin(request, CLIENT_ERROR_MAX_BYTES);
  if (body === null) {
    return { status: 413, report: null };
  }

  return { status: 204, report: parseReport(body, request.headers.get('x-correlation-id')) };
}

export function formatClientErrorReport(report: ClientErrorReport): string {
  const where = report.filename ? ` at ${report.filename}:${report.lineno}:${report.colno}` : '';
  const correlation = report.correlationId ? ` (${report.correlationId})` : '';
  const firstStackLine = report.stack.split('\n').find((line) => line.trim().length > 0) ?? '';
  const stack =
    firstStackLine && !report.message.includes(firstStackLine.trim())
      ? `\n  ${firstStackLine.trim()}`
      : '';
  return `${report.type}: ${report.message}${where}${correlation}${stack}`;
}

async function readBodyWithin(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) {
    return '';
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

function parseReport(body: string, correlationHeader: string | null): ClientErrorReport | null {
  if (body.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const raw = parsed as Record<string, unknown>;
  return {
    type: asText(raw.type) || 'error',
    message: asText(raw.message) || 'Client error',
    stack: asText(raw.stack),
    filename: asText(raw.filename),
    lineno: asInteger(raw.lineno),
    colno: asInteger(raw.colno),
    pageUrl: asText(raw.pageUrl),
    userAgent: asText(raw.userAgent),
    timestamp: asText(raw.timestamp),
    correlationId: asText(raw.correlationId) || (correlationHeader ?? '').trim(),
  };
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}
