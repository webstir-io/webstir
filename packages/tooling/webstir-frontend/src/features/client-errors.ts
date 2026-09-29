/**
 * Reports the page's uncaught errors and unhandled rejections to the app's server, which logs them
 * (`POST /client-errors`). Throttled to one a second and twenty a page, with repeats of the same
 * error within a minute dropped. The build includes it in the app bundle of an app with a server;
 * `webstir.enable.clientErrors` in package.json turns it on or off.
 */

const ENDPOINT = '/client-errors';
const MAX_PER_PAGE = 20;
const MIN_INTERVAL_MS = 1000;
const REPEAT_WINDOW_MS = 60_000;
// The flag older apps' own reporter checks too, so the two never both install.
const INSTALLED = '__WEBSTIR_ERROR_HANDLER_INSTALLED__';

interface ClientErrorReport {
  type: 'error' | 'unhandledrejection';
  message: string;
  stack: string;
  filename: string;
  lineno: number;
  colno: number;
  pageUrl: string;
  userAgent: string;
  timestamp: string;
  correlationId: string;
}

type ReporterWindow = Window & { __WEBSTIR_CID__?: string; [INSTALLED]?: boolean };

let lastSentAt = 0;
let sentCount = 0;
const recent = new Map<string, number>();

function correlationId(): string {
  const w = window as ReporterWindow;
  w.__WEBSTIR_CID__ ??= `c-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return w.__WEBSTIR_CID__;
}

function toReport(event: ErrorEvent | PromiseRejectionEvent): ClientErrorReport {
  const rejection = event.type === 'unhandledrejection';
  const reason = rejection ? ((event as PromiseRejectionEvent).reason ?? {}) : {};
  const error = (event as ErrorEvent).error ?? reason ?? {};
  return {
    type: rejection ? 'unhandledrejection' : 'error',
    message: String(
      (event as ErrorEvent).message || reason.message || error?.message || 'Unknown error',
    ),
    stack: String(error?.stack || reason.stack || ''),
    filename: String((event as ErrorEvent).filename || ''),
    lineno: Number((event as ErrorEvent).lineno || 0),
    colno: Number((event as ErrorEvent).colno || 0),
    pageUrl: String(location.href),
    userAgent: String(navigator.userAgent || ''),
    timestamp: new Date().toISOString(),
    correlationId: correlationId(),
  };
}

// 32-bit FNV-1a, to tell one stack from another without sending it twice.
function hash(value: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(36);
}

function shouldSend(report: ClientErrorReport): boolean {
  const now = Date.now();
  if (now - lastSentAt < MIN_INTERVAL_MS || sentCount >= MAX_PER_PAGE) return false;
  const fingerprint = [
    report.type,
    report.message,
    `${report.filename}:${report.lineno}:${report.colno}`,
    hash(report.stack),
  ].join('|');
  if (recent.size > 100) {
    for (const [key, at] of recent) if (now - at > REPEAT_WINDOW_MS) recent.delete(key);
  }
  if (now - (recent.get(fingerprint) ?? 0) < REPEAT_WINDOW_MS) return false;
  recent.set(fingerprint, now);
  lastSentAt = now;
  sentCount++;
  return true;
}

function send(event: ErrorEvent | PromiseRejectionEvent): void {
  try {
    const report = toReport(event);
    if (!shouldSend(report)) return;
    const body = JSON.stringify(report);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
    } else {
      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Correlation-ID': report.correlationId },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Reporting must never throw from inside an error handler.
  }
}

export function installClientErrors(): void {
  const w = window as ReporterWindow;
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;
  window.addEventListener('error', send);
  window.addEventListener('unhandledrejection', send);
}

if (typeof window !== 'undefined') installClientErrors();
