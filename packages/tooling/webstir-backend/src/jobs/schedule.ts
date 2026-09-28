export type Schedule =
  | { readonly kind: 'cron'; readonly expression: string }
  | { readonly kind: 'rate'; readonly intervalMs: number }
  | { readonly kind: 'reboot' };

const UNITS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** A cron expression (`0 3 * * *`), a nickname (`@daily`), `@reboot`, or `rate(5 minutes)`. */
export function parseSchedule(value: string): Schedule | undefined {
  const text = value.trim().toLowerCase();
  if (text === '@reboot') return { kind: 'reboot' };
  const rate = /^rate\((\d+)\s+(second|minute|hour|day)s?\)$/.exec(text);
  if (rate) {
    const amount = Number(rate[1]);
    return amount > 0
      ? { kind: 'rate', intervalMs: amount * (UNITS[rate[2] as string] ?? 0) }
      : undefined;
  }
  try {
    return Bun.cron.parse(text) ? { kind: 'cron', expression: text } : undefined;
  } catch {
    return undefined;
  }
}

/** When a schedule next runs after `from`, or undefined when it never does again. */
export function nextRun(schedule: Schedule, from: Date): Date | undefined {
  if (schedule.kind === 'rate') return new Date(from.getTime() + schedule.intervalMs);
  if (schedule.kind === 'reboot') return undefined;
  return Bun.cron.parse(schedule.expression, from) ?? undefined;
}
