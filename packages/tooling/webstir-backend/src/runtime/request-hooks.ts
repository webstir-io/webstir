export type RequestHookPhase = 'beforeAuth' | 'beforeHandler' | 'afterHandler';

export interface RequestHookDefinitionLike {
  id?: string;
  phase?: RequestHookPhase;
  order?: number;
}

export interface RequestHookReferenceLike {
  id?: string;
}

export type RequestHookHandler<TContext, TResult, TRoute> = (
  context: TContext,
  input: { phase: RequestHookPhase; route: TRoute; result?: TResult },
) => Promise<TResult | undefined> | TResult | undefined;

export interface RegisteredRequestHook<TContext, TResult, TRoute> {
  id?: string;
  handler?: RequestHookHandler<TContext, TResult, TRoute>;
}

export interface CompiledRequestHook<TContext, TResult, TRoute> {
  id: string;
  phase: RequestHookPhase;
  order: number;
  handler: RequestHookHandler<TContext, TResult, TRoute>;
}

export function resolveRequestHooks<TContext, TResult, TRoute>(options: {
  routeName: string;
  routeReferences?: readonly RequestHookReferenceLike[];
  manifestDefinitions?: readonly RequestHookDefinitionLike[];
  registrations?: readonly RegisteredRequestHook<TContext, TResult, TRoute>[];
}): { hooks: CompiledRequestHook<TContext, TResult, TRoute>[]; warnings: string[] } {
  const definitions = new Map<string, RequestHookDefinitionLike>();
  for (const definition of options.manifestDefinitions ?? []) {
    if (!definition?.id) {
      continue;
    }
    definitions.set(definition.id, definition);
  }

  const registrations = new Map<string, RequestHookHandler<TContext, TResult, TRoute>>();
  for (const registration of options.registrations ?? []) {
    if (!registration?.id || typeof registration.handler !== 'function') {
      continue;
    }
    registrations.set(registration.id, registration.handler);
  }

  const hooks: CompiledRequestHook<TContext, TResult, TRoute>[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const reference of options.routeReferences ?? []) {
    const hookId = reference?.id?.trim();
    if (!hookId || seen.has(hookId)) {
      continue;
    }
    seen.add(hookId);

    const definition = definitions.get(hookId);
    if (!definition?.phase) {
      warnings.push(
        `Route "${options.routeName}" references request hook "${hookId}" without manifest metadata.`,
      );
      continue;
    }

    const handler = registrations.get(hookId);
    if (!handler) {
      warnings.push(
        `Route "${options.routeName}" references request hook "${hookId}" without an implementation.`,
      );
      continue;
    }

    hooks.push({
      id: hookId,
      phase: definition.phase,
      order: Number.isInteger(definition.order) ? Number(definition.order) : 0,
      handler,
    });
  }

  hooks.sort((left, right) => {
    const phaseDelta = compareRequestHookPhase(left.phase, right.phase);
    if (phaseDelta !== 0) {
      return phaseDelta;
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.id.localeCompare(right.id);
  });

  return { hooks, warnings };
}

export async function executeRequestHookPhase<TContext, TResult, TRoute>(options: {
  hooks: readonly CompiledRequestHook<TContext, TResult, TRoute>[];
  phase: RequestHookPhase;
  context: TContext;
  route: TRoute;
  logger?: {
    info?(message: string, metadata?: Record<string, unknown>): void;
    error?(message: string, metadata?: Record<string, unknown>): void;
  };
  result?: TResult;
}): Promise<{ result?: TResult; shortCircuited: boolean }> {
  let currentResult = options.result;

  for (const hook of options.hooks) {
    if (hook.phase !== options.phase) {
      continue;
    }

    try {
      const hookResult = await hook.handler(options.context, {
        phase: options.phase,
        route: options.route,
        result: currentResult,
      });

      if (options.phase === 'afterHandler') {
        if (hookResult !== undefined) {
          currentResult = hookResult;
        }
        continue;
      }

      if (hookResult !== undefined) {
        options.logger?.info?.('request hook produced early response', {
          hookId: hook.id,
          phase: hook.phase,
        });
        return { result: hookResult, shortCircuited: true };
      }
    } catch (error) {
      options.logger?.error?.('request hook failed', {
        err: error,
        hookId: hook.id,
        phase: hook.phase,
      });
      throw error;
    }
  }

  return { result: currentResult, shortCircuited: false };
}

function compareRequestHookPhase(left: RequestHookPhase, right: RequestHookPhase): number {
  return requestHookPhaseWeight(left) - requestHookPhaseWeight(right);
}

function requestHookPhaseWeight(phase: RequestHookPhase): number {
  if (phase === 'beforeAuth') {
    return 0;
  }
  if (phase === 'beforeHandler') {
    return 1;
  }
  return 2;
}
