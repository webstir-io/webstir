export const STRUCTURED_DIAGNOSTIC_PREFIX = 'WEBSTIR_DIAGNOSTIC ';

export type WatchStatus = 'building' | 'success' | 'error' | 'hmr-fallback';

export interface StructuredDiagnosticPayload {
  readonly type: 'diagnostic';
  readonly code: string;
  readonly kind: string;
  readonly stage: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

export interface HotUpdateAsset {
  readonly type: 'js' | 'css';
  readonly path: string;
  readonly relativePath: string;
  readonly url: string;
}

export interface HotUpdateTarget {
  readonly kind: 'boundary';
  readonly id: string;
}

export interface HotUpdatePayload {
  readonly requiresReload: boolean;
  readonly modules: readonly HotUpdateAsset[];
  readonly styles: readonly HotUpdateAsset[];
  readonly target?: HotUpdateTarget;
  readonly changedFile?: string;
  readonly fallbackReasons?: readonly string[];
  readonly stats?: {
    readonly hotUpdates: number;
    readonly reloadFallbacks: number;
  };
}

export type WatchAction =
  | { readonly type: 'status'; readonly status: WatchStatus }
  | { readonly type: 'hmr'; readonly payload: HotUpdatePayload }
  | { readonly type: 'reload' };

export function parseStructuredDiagnosticLine(line: string): StructuredDiagnosticPayload | null {
  if (!line.startsWith(STRUCTURED_DIAGNOSTIC_PREFIX)) {
    return null;
  }

  const rawPayload = line.slice(STRUCTURED_DIAGNOSTIC_PREFIX.length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return null;
  }

  if (!isStructuredDiagnosticPayload(parsed)) {
    return null;
  }

  return parsed;
}

export function collectWatchActions(payload: StructuredDiagnosticPayload): readonly WatchAction[] {
  if (isBuildStartDiagnostic(payload.code)) {
    return [{ type: 'status', status: 'building' }];
  }

  if (isBuildFailureDiagnostic(payload.code)) {
    return [{ type: 'status', status: 'error' }];
  }

  if (payload.code === 'frontend.watch.pipeline.hmrfallback') {
    return [{ type: 'status', status: 'hmr-fallback' }];
  }

  if (payload.code !== 'frontend.watch.pipeline.success') {
    return [];
  }

  const hotUpdate = readHotUpdatePayload(payload.data);
  const changedFile =
    typeof hotUpdate?.changedFile === 'string' ? hotUpdate.changedFile : undefined;
  if (!hotUpdate || !changedFile) {
    return [{ type: 'status', status: 'success' }];
  }

  if (hotUpdate.requiresReload) {
    return [{ type: 'status', status: 'hmr-fallback' }, { type: 'reload' }];
  }

  if (hotUpdate.modules.length === 0 && hotUpdate.styles.length === 0) {
    return [{ type: 'status', status: 'success' }];
  }

  return [
    { type: 'hmr', payload: hotUpdate },
    { type: 'status', status: 'success' },
  ];
}

function isBuildStartDiagnostic(code: string): boolean {
  return (
    code === 'frontend.watch.starting' ||
    code === 'frontend.watch.reload' ||
    code.endsWith('.build.start')
  );
}

function isBuildFailureDiagnostic(code: string): boolean {
  return (
    code === 'frontend.watch.unexpected' ||
    code === 'frontend.watch.command.failure' ||
    code.endsWith('.build.failure')
  );
}

function readHotUpdatePayload(data: Record<string, unknown> | undefined): HotUpdatePayload | null {
  if (!data) {
    return null;
  }

  const candidate = data.hotUpdate;
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const payload = candidate as Record<string, unknown>;
  if (typeof payload.requiresReload !== 'boolean') {
    return null;
  }

  return {
    requiresReload: payload.requiresReload,
    modules: readAssets(payload.modules),
    styles: readAssets(payload.styles),
    target: readTarget(payload.target),
    changedFile: typeof payload.changedFile === 'string' ? payload.changedFile : undefined,
    fallbackReasons: Array.isArray(payload.fallbackReasons)
      ? payload.fallbackReasons.filter((value): value is string => typeof value === 'string')
      : undefined,
    stats: readStats(payload.stats),
  };
}

function readAssets(value: unknown): readonly HotUpdateAsset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      return [];
    }

    const asset = candidate as Record<string, unknown>;
    if (
      (asset.type !== 'js' && asset.type !== 'css') ||
      typeof asset.path !== 'string' ||
      typeof asset.relativePath !== 'string' ||
      typeof asset.url !== 'string'
    ) {
      return [];
    }

    return [
      {
        type: asset.type,
        path: asset.path,
        relativePath: asset.relativePath,
        url: asset.url,
      },
    ];
  });
}

function readStats(value: unknown): HotUpdatePayload['stats'] | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const stats = value as Record<string, unknown>;
  if (typeof stats.hotUpdates !== 'number' || typeof stats.reloadFallbacks !== 'number') {
    return undefined;
  }

  return {
    hotUpdates: stats.hotUpdates,
    reloadFallbacks: stats.reloadFallbacks,
  };
}

function readTarget(value: unknown): HotUpdateTarget | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const target = value as Record<string, unknown>;
  if (target.kind !== 'boundary' || typeof target.id !== 'string' || target.id.trim() === '') {
    return undefined;
  }

  return {
    kind: 'boundary',
    id: target.id,
  };
}

function isStructuredDiagnosticPayload(value: unknown): value is StructuredDiagnosticPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    payload.type === 'diagnostic' &&
    typeof payload.code === 'string' &&
    typeof payload.kind === 'string' &&
    typeof payload.stage === 'string' &&
    typeof payload.severity === 'string' &&
    typeof payload.message === 'string'
  );
}
