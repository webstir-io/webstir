const DEFAULT_SECONDS = 4;
const MAX_TIMEOUT_MS = 2_147_483_647;

/** How long a stopping server waits for what is in flight: SHUTDOWN_TIMEOUT seconds, 4 by default. */
export function shutdownTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.SHUTDOWN_TIMEOUT?.trim();
  const seconds = raw ? Number(raw) : DEFAULT_SECONDS;
  const ms = (Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_SECONDS) * 1000;
  // A timer holds at most about 24.8 days; longer than that is as long as it can wait.
  return Math.min(ms, MAX_TIMEOUT_MS);
}

/** Whether the work finished within the limit; the work itself is left running when it did not. */
export async function finishedWithin(work: Promise<unknown>, limitMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), limitMs);
  });
  try {
    return await Promise.race([work.then(() => true as const), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stops a server taking new connections and lets the requests in flight finish. Past the limit
 * the ones still open are closed. Answers whether every request finished.
 */
export async function drainServer(
  server: { stop(closeActiveConnections?: boolean): Promise<void> | void },
  limitMs: number,
): Promise<boolean> {
  const drained = await finishedWithin(Promise.resolve(server.stop()), limitMs);
  if (!drained) await server.stop(true);
  return drained;
}
