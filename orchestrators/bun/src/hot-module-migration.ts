// Workspaces scaffolded before the hot-module registry moved into hmr.js carry
// the registry in app.ts. When that block is still the scaffold's own, repair
// swaps it for the thin registration that the dev-only client now reads. A
// block that has been customized is left alone and reported instead.

export type HotModuleMigration =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rewritten'; readonly source: string }
  | { readonly kind: 'customized'; readonly reason: string };

const LEGACY_HOOK = 'window.__webstirRegisterHotModule';
const TYPES_START = 'type HotAsset = {';
const TYPES_END = '// Lazy-load error handler on first error';
const REGISTRY_START = 'export function registerHotModule(';
const REGISTRY_END = '// Set up error listeners';
const ALLOWED_WINDOW_ASSIGNMENTS = new Set([
  '__webstirRegisterHotModule',
  '__webstirDispose',
  '__webstirAccept',
]);
const REMOVED_IDENTIFIERS = [
  'hotModuleRegistry',
  'ensureRecord',
  'normalizeModuleId',
  'isPromise',
  'withHistoryContext',
  'evaluateHandlerResult',
  'HotModuleRecord',
];

export const HOT_MODULE_REGISTRATION = `// Pages can opt into hot module updates. During development the dev server's
// HMR client (hmr.js) reads these registrations; in production nothing reads
// them, so this is a few bytes and no behaviour.

export type HotAsset = {
  type: 'js' | 'css';
  url: string;
  relativePath: string;
};

export type HotModuleContext = {
  changedFile: string | null;
  modules: ReadonlyArray<HotAsset>;
  styles: ReadonlyArray<HotAsset>;
  cacheBuster: string;
  timestamp: number;
  asset?: HotAsset;
  previousExports?: unknown;
};

export type HotModuleHandlers = {
  accept?: (moduleExports: unknown, context: HotModuleContext) => boolean | Promise<boolean>;
  dispose?: (context: HotModuleContext) => void | Promise<void>;
};

export type HotModuleRegistration = { moduleId: string; handlers: HotModuleHandlers };

declare global {
  interface Window {
    __webstirEventSource?: EventSource;
    __webstirSetDevStatus?: (status: string, message?: string) => void;
    __webstirOnHmrFallback?: (info: { reason?: string; payload?: unknown; details?: unknown }) => void;
    __webstirHotModules?: HotModuleRegistration[];
  }
}

export function registerHotModule(moduleId: string, handlers: HotModuleHandlers): void {
  (window.__webstirHotModules ??= []).push({ moduleId, handlers });
}

`;

export function migrateHotModuleRegistry(source: string): HotModuleMigration {
  if (!source.includes(LEGACY_HOOK)) {
    return { kind: 'unchanged' };
  }

  const types = locateSpan(source, TYPES_START, TYPES_END);
  if (!types) {
    return customized('the hot-module types block is not laid out the way the scaffold wrote it');
  }
  const registry = locateSpan(source, REGISTRY_START, REGISTRY_END);
  if (!registry) {
    return customized('the registry block is not laid out the way the scaffold wrote it');
  }
  if (types.end > registry.start) {
    return customized('the types and registry blocks are not in the scaffold order');
  }

  const assignments = [...source.slice(registry.start, registry.end).matchAll(/window\.(\w+)\s*=/g)]
    .map((match) => match[1] ?? '')
    .filter(Boolean);
  const unexpected = assignments.filter((name) => !ALLOWED_WINDOW_ASSIGNMENTS.has(name));
  if (unexpected.length > 0) {
    return customized(`the registry block also installs window.${unexpected[0]}`);
  }
  if (/window\.\w+\s*=/.test(source.slice(types.start, types.end))) {
    return customized('the types block installs window hooks of its own');
  }

  const remainder =
    source.slice(0, types.start) +
    source.slice(types.end, registry.start) +
    source.slice(registry.end);
  const stillUsed = REMOVED_IDENTIFIERS.find((name) => new RegExp(`\\b${name}\\b`).test(remainder));
  if (stillUsed) {
    return customized(`code outside the registry block still uses ${stillUsed}`);
  }

  const rewritten =
    source.slice(0, types.start) +
    HOT_MODULE_REGISTRATION +
    source.slice(types.end, registry.start) +
    source.slice(registry.end);
  return { kind: 'rewritten', source: rewritten };
}

function locateSpan(
  source: string,
  startMarker: string,
  endMarker: string,
): { readonly start: number; readonly end: number } | null {
  const start = source.indexOf(startMarker);
  if (start < 0 || source.indexOf(startMarker, start + 1) >= 0) {
    return null;
  }
  const end = source.indexOf(endMarker, start);
  if (end < 0 || source.indexOf(endMarker, end + 1) >= 0) {
    return null;
  }
  return { start, end };
}

function customized(reason: string): HotModuleMigration {
  return { kind: 'customized', reason };
}
