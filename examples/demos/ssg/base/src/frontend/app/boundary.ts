export type CleanupHandler = () => void | Promise<void>;

export interface CleanupScope {
  add(cleanup: CleanupHandler): void;
  dispose(): Promise<void>;
}

export interface BoundarySpec<TState = void> {
  mount(root: Element, scope: CleanupScope): TState | Promise<TState>;
  unmount?(state: TState, scope: CleanupScope): void | Promise<void>;
}

export interface Boundary<TState = void> {
  mount(root: Element): Promise<TState>;
  unmount(): Promise<void>;
}

export function createCleanupScope(): CleanupScope {
  const cleanups: CleanupHandler[] = [];
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  return {
    add(cleanup: CleanupHandler): void {
      if (disposed) {
        throw new Error('Cleanup scope has already been disposed.');
      }

      cleanups.push(cleanup);
    },
    dispose(): Promise<void> {
      if (disposePromise) {
        return disposePromise;
      }

      disposed = true;
      disposePromise = (async () => {
        let firstError: unknown;

        for (let index = cleanups.length - 1; index >= 0; index -= 1) {
          const cleanup = cleanups[index];
          if (!cleanup) {
            continue;
          }

          try {
            await cleanup();
          } catch (error) {
            if (firstError === undefined) {
              firstError = error;
            }
          }
        }

        cleanups.length = 0;

        if (firstError !== undefined) {
          throw firstError;
        }
      })();

      return disposePromise;
    }
  };
}

export function defineBoundary<TState = void>(spec: BoundarySpec<TState>): Boundary<TState> {
  let currentRoot: Element | null = null;
  let currentScope: CleanupScope | null = null;
  let currentState: TState | undefined;
  let mountPromise: Promise<TState> | null = null;
  let unmountPromise: Promise<void> | null = null;

  const reset = (): void => {
    currentRoot = null;
    currentScope = null;
    currentState = undefined;
    mountPromise = null;
    unmountPromise = null;
  };

  return {
    async mount(root: Element): Promise<TState> {
      if (currentScope || mountPromise || unmountPromise) {
        throw new Error('Boundary is already mounted.');
      }

      currentRoot = root;
      currentScope = createCleanupScope();
      const scope = currentScope;

      mountPromise = (async () => {
        try {
          const state = await spec.mount(root, scope);
          currentState = state;
          return state;
        } catch (error) {
          await scope.dispose().catch(() => undefined);
          reset();
          throw error;
        }
      })();

      return await mountPromise;
    },
    async unmount(): Promise<void> {
      if (!currentScope) {
        return;
      }

      if (unmountPromise) {
        return await unmountPromise;
      }

      const scope = currentScope;
      const state = currentState as TState;
      const mountTask = mountPromise;
      const root = currentRoot;

      unmountPromise = (async () => {
        let firstError: unknown;

        if (mountTask) {
          try {
            await mountTask;
          } catch (error) {
            firstError = error;
          }
        }

        if (!firstError && spec.unmount && root) {
          try {
            await spec.unmount(state, scope);
          } catch (error) {
            firstError = error;
          }
        }

        try {
          await scope.dispose();
        } catch (error) {
          if (firstError === undefined) {
            firstError = error;
          }
        }

        reset();

        if (firstError !== undefined) {
          throw firstError;
        }
      })();

      return await unmountPromise;
    }
  };
}
