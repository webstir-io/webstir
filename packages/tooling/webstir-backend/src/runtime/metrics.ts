import type { MetricsTracker } from './bun.js';

/**
 * Request counts and timings for `/metrics`, over the last METRICS_WINDOW requests (default 200).
 * METRICS_ENABLED=off turns them off.
 */
export function createRequestMetricsTracker(
  env: Record<string, string | undefined> = process.env,
): MetricsTracker {
  if (['off', '0', 'false', 'no'].includes((env.METRICS_ENABLED ?? '').trim().toLowerCase())) {
    return { record() {}, snapshot: () => ({ enabled: false }) };
  }
  const window = Math.max(1, Math.floor(Number(env.METRICS_WINDOW) || 200));
  let totalRequests = 0;
  let errorCount = 0;
  const byStatus = new Map<number, number>();
  const durations: number[] = [];

  return {
    record(event) {
      totalRequests += 1;
      if (event.status >= 500) errorCount += 1;
      byStatus.set(event.status, (byStatus.get(event.status) ?? 0) + 1);
      durations.push(event.durationMs);
      if (durations.length > window) durations.shift();
    },
    snapshot() {
      const sorted = [...durations].sort((a, b) => a - b);
      return {
        enabled: true,
        totalRequests,
        errorCount,
        averageDurationMs:
          sorted.length > 0 ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : 0,
        p95DurationMs:
          sorted.length > 0
            ? (sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))] ?? 0)
            : 0,
        byStatus: Object.fromEntries(
          [...byStatus].map(([status, count]) => [String(status), count]),
        ),
        windowSize: window,
      };
    },
  };
}
