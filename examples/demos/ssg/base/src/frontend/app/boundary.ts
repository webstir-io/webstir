export type CleanupHandler = () => void | Promise<void>;

export interface CleanupScope {
  add(cleanup: CleanupHandler): void;
  dispose(): Promise<void>;
}

export interface ManagedObserver {
  disconnect(): void;
}

export interface BoundaryScope extends CleanupScope {
  mountChild<TState>(boundary: Boundary<TState>, root: Element): Promise<Boundary<TState>>;
}

export interface BoundarySpec<TState = void> {
  mount(root: Element, scope: BoundaryScope): TState | Promise<TState>;
  unmount?(state: TState, scope: BoundaryScope): void | Promise<void>;
  snapshotState?(state: TState): unknown | Promise<unknown>;
  restoreState?(root: Element, scope: BoundaryScope, state: unknown): TState | Promise<TState>;
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

export function listen(
  scope: CleanupScope,
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
): void {
  target.addEventListener(type, listener, options);
  scope.add(() => {
    target.removeEventListener(type, listener, options);
  });
}

export function scheduleTimeout(
  scope: CleanupScope,
  callback: TimerHandler,
  delay = 0,
  ...args: unknown[]
): Parameters<typeof clearTimeout>[0] {
  const handle = setTimeout(callback, delay, ...args) as Parameters<typeof clearTimeout>[0];
  scope.add(() => {
    clearTimeout(handle);
  });
  return handle;
}

export function scheduleInterval(
  scope: CleanupScope,
  callback: TimerHandler,
  delay = 0,
  ...args: unknown[]
): Parameters<typeof clearInterval>[0] {
  const handle = setInterval(callback, delay, ...args) as Parameters<typeof clearInterval>[0];
  scope.add(() => {
    clearInterval(handle);
  });
  return handle;
}

export function trackObserver<TObserver extends ManagedObserver>(scope: CleanupScope, observer: TObserver): TObserver {
  scope.add(() => {
    observer.disconnect();
  });
  return observer;
}

export function createAbortController(scope: CleanupScope): AbortController {
  const controller = new AbortController();
  scope.add(() => {
    controller.abort();
  });
  return controller;
}

function createBoundaryScope() {
  const scope = createCleanupScope();
  const children = new Set<Boundary<unknown>>();
  let disposed = false;
  let disposeChildrenPromise: Promise<void> | null = null;

  return {
    ...scope,
    async mountChild<TState>(boundary: Boundary<TState>, root: Element): Promise<Boundary<TState>> {
      if (disposed) {
        throw new Error('Boundary scope has already been disposed.');
      }

      await boundary.mount(root);
      children.delete(boundary);
      children.add(boundary);
      return boundary;
    },
    async disposeChildren(): Promise<void> {
      if (disposeChildrenPromise) {
        return disposeChildrenPromise;
      }

      disposed = true;
      disposeChildrenPromise = (async () => {
        let firstError: unknown;

        const orderedChildren = Array.from(children);
        for (let index = orderedChildren.length - 1; index >= 0; index -= 1) {
          const child = orderedChildren[index];
          if (!child) {
            continue;
          }

          try {
            await child.unmount();
          } catch (error) {
            if (firstError === undefined) {
              firstError = error;
            }
          }
        }

        children.clear();

        if (firstError !== undefined) {
          throw firstError;
        }
      })();

      return disposeChildrenPromise;
    }
  };
}

export function defineBoundary<TState = void>(spec: BoundarySpec<TState>): Boundary<TState> {
  let currentRoot: Element | null = null;
  let currentScope: BoundaryScope | null = null;
  let currentChildScope: ReturnType<typeof createBoundaryScope> | null = null;
  let currentState: TState | undefined;
  let pendingHotState: unknown;
  let hasPendingHotState = false;
  let mountPromise: Promise<TState> | null = null;
  let unmountPromise: Promise<void> | null = null;

  const reset = (preserveHotState = false): void => {
    currentRoot = null;
    currentScope = null;
    currentChildScope = null;
    currentState = undefined;
    mountPromise = null;
    unmountPromise = null;
    if (!preserveHotState) {
      pendingHotState = undefined;
      hasPendingHotState = false;
    }
  };

  return {
    async mount(root: Element): Promise<TState> {
      if (currentScope || mountPromise || unmountPromise) {
        throw new Error('Boundary is already mounted.');
      }

      currentRoot = root;
      currentChildScope = createBoundaryScope();
      currentScope = currentChildScope;
      const scope = currentScope;
      const hotState = hasPendingHotState ? pendingHotState : undefined;
      pendingHotState = undefined;
      hasPendingHotState = false;

      mountPromise = (async () => {
        try {
          const state = hotState !== undefined && spec.restoreState
            ? await spec.restoreState(root, scope, hotState)
            : await spec.mount(root, scope);
          currentState = state;
          return state;
        } catch (error) {
          await currentChildScope?.disposeChildren().catch(() => undefined);
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
      const childScope = currentChildScope;
      const state = currentState as TState;
      const mountTask = mountPromise;
      const root = currentRoot;

      unmountPromise = (async () => {
        let firstError: unknown;
        let capturedHotState: unknown;
        let hasCapturedHotState = false;

        if (mountTask) {
          try {
            await mountTask;
          } catch (error) {
            firstError = error;
          }
        }

        if (!firstError && spec.snapshotState) {
          try {
            capturedHotState = await spec.snapshotState(state);
            hasCapturedHotState = capturedHotState !== undefined;
          } catch (error) {
            firstError = error;
          }
        }

        if (childScope) {
          try {
            await childScope.disposeChildren();
          } catch (error) {
            if (firstError === undefined) {
              firstError = error;
            }
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

        if (firstError === undefined && hasCapturedHotState) {
          pendingHotState = capturedHotState;
          hasPendingHotState = true;
        } else {
          pendingHotState = undefined;
          hasPendingHotState = false;
        }

        reset(hasCapturedHotState && firstError === undefined);

        if (firstError !== undefined) {
          throw firstError;
        }
      })();

      return await unmountPromise;
    }
  };
}
