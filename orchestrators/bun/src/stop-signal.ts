export interface StopSignal {
  readonly promise: Promise<void>;
  dispose(): void;
}

// A closed terminal or an ended session hangs up rather than interrupts. Unheard, it ends the
// command at once and leaves the servers it started running.
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export function createStopSignal(): StopSignal {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  const handleSignal = () => {
    resolvePromise?.();
  };

  for (const signal of STOP_SIGNALS) process.on(signal, handleSignal);

  return {
    promise,
    dispose() {
      for (const signal of STOP_SIGNALS) process.off(signal, handleSignal);
    },
  };
}
