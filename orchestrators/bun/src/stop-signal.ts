export interface StopSignal {
  readonly promise: Promise<void>;
  dispose(): void;
}

export function createStopSignal(): StopSignal {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  const handleSignal = () => {
    resolvePromise?.();
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  return {
    promise,
    dispose() {
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
    },
  };
}
