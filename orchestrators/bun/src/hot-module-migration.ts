// Workspaces scaffolded before the hot-module registry moved into hmr.js carry
// the registry in app.ts and read it with an older hmr.js. Repair brings the
// pair forward together, and only when both files are still byte-for-byte the
// scaffold's own: a customized app entry or client is reported, never rewritten.

import { createHash } from 'node:crypto';

export type HotModuleMigration =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rewritten'; readonly source: string }
  | { readonly kind: 'customized'; readonly reason: string };

export type HmrClientKind = 'current' | 'legacy' | 'custom';

// Any mention of these means the entry still speaks to the older client, so
// only an exact scaffold match may rewrite it, and nothing else may refresh
// the client underneath it.
const LEGACY_HOOK_PATTERN = /__webstirRegisterHotModule|__webstirDispose|__webstirAccept/;
// Definitions the rewrite removes; a reference to any of them outside the two
// spans means the file has grown beyond the scaffold.
const REMOVED_DEFINITIONS = [
  'hotModuleRegistry',
  'ensureRecord',
  'normalizeModuleId',
  'isPromise',
  'withHistoryContext',
  'evaluateHandlerResult',
  'HotModuleRecord',
];
const TYPES_START = 'type HotAsset = {';
const TYPES_END = '// Lazy-load error handler on first error';
const REGISTRY_START = 'export function registerHotModule(';
const REGISTRY_END = '// Set up error listeners';

// The exact blocks every scaffold wrote between the markers above, from the
// first Bun template through 0.1.58. Rewriting requires both to match.
const LEGACY_TYPES_BLOCK =
  "type HotAsset = {\n  type: 'js' | 'css';\n  url: string;\n  relativePath: string;\n};\n\ntype HotModuleContext = {\n  changedFile: string | null;\n  modules: ReadonlyArray<HotAsset>;\n  styles: ReadonlyArray<HotAsset>;\n  cacheBuster: string;\n  timestamp: number;\n  asset?: HotAsset;\n  previousExports?: unknown;\n};\n\ntype HotModuleHandlers = {\n  accept?: (moduleExports: unknown, context: HotModuleContext) => boolean | Promise<boolean>;\n  dispose?: (context: HotModuleContext) => void | Promise<void>;\n};\n\ntype HotModuleRecord = HotModuleHandlers & {\n  currentExports?: unknown;\n};\n\ndeclare global {\n  interface Window {\n    __webstirEventSource?: EventSource;\n    __webstirSetDevStatus?: (status: string, message?: string) => void;\n    __webstirOnHmrFallback?: (info: { reason?: string; payload?: unknown; details?: unknown }) => void;\n    __webstirRegisterHotModule?: (moduleId: string, handlers: HotModuleHandlers) => void;\n    __webstirDispose?: (asset: HotAsset | undefined, context: HotModuleContext) => boolean | Promise<boolean>;\n    __webstirAccept?: (moduleExports: unknown, context: HotModuleContext) => boolean | Promise<boolean>;\n  }\n}\n\nconst hotModuleRegistry = new Map<string, HotModuleRecord>();\n\nfunction ensureRecord(moduleId: string): HotModuleRecord {\n  const existing = hotModuleRegistry.get(moduleId);\n  if (existing) {\n    return existing;\n  }\n\n  const created: HotModuleRecord = {};\n  hotModuleRegistry.set(moduleId, created);\n  return created;\n}\n\nfunction normalizeModuleId(candidate?: string | null): string | null {\n  if (!candidate) {\n    return null;\n  }\n\n  try {\n    const url = new URL(candidate, window.location.origin);\n    return url.pathname;\n  } catch {\n    const index = candidate.indexOf('?');\n    return index === -1 ? candidate : candidate.slice(0, index);\n  }\n}\n\nfunction isPromise<T = unknown>(value: unknown): value is Promise<T> {\n  return !!value && typeof (value as PromiseLike<T>).then === 'function';\n}\n\nfunction withHistoryContext(context: HotModuleContext, record: HotModuleRecord): HotModuleContext {\n  if (!record.currentExports) {\n    return context;\n  }\n\n  return {\n    ...context,\n    previousExports: record.currentExports\n  };\n}\n\nasync function evaluateHandlerResult(result: unknown): Promise<boolean> {\n  if (isPromise(result)) {\n    const resolved = await result;\n    return resolved !== false;\n  }\n\n  return result !== false;\n}\n\n";

const LEGACY_REGISTRY_BLOCK =
  // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the scaffold's own source text, template literals included
  'export function registerHotModule(moduleId: string, handlers: HotModuleHandlers): void {\n  const normalized = normalizeModuleId(moduleId);\n  if (!normalized) {\n    return;\n  }\n\n  const record = ensureRecord(normalized);\n  record.accept = handlers.accept;\n  record.dispose = handlers.dispose;\n  hotModuleRegistry.set(normalized, record);\n}\n\nwindow.__webstirRegisterHotModule = registerHotModule;\n\nwindow.__webstirDispose = async (asset, context) => {\n  const moduleId = normalizeModuleId(asset?.url ?? asset?.relativePath);\n  if (!moduleId) {\n    return true;\n  }\n\n  const record = hotModuleRegistry.get(moduleId);\n  if (!record) {\n    return true;\n  }\n\n  if (!record.dispose) {\n    return true;\n  }\n\n  const contextWithHistory = withHistoryContext(context, record);\n\n  try {\n    const result = record.dispose(contextWithHistory);\n    if (isPromise(result)) {\n      await result;\n    }\n    return true;\n  } catch (error) {\n    console.error(`[webstir-hmr] Dispose handler failed for ${moduleId}.`, error);\n    return false;\n  }\n};\n\nwindow.__webstirAccept = async (moduleExports, context) => {\n  const moduleId = normalizeModuleId(context?.asset?.url ?? context?.asset?.relativePath);\n  if (!moduleId) {\n    return true;\n  }\n\n  const record = ensureRecord(moduleId);\n  const contextWithHistory = withHistoryContext(context, record);\n\n  let accepted = true;\n\n  if (record.accept) {\n    try {\n      accepted = await evaluateHandlerResult(record.accept(moduleExports, contextWithHistory));\n    } catch (error) {\n      console.error(`[webstir-hmr] Accept handler failed for ${moduleId}.`, error);\n      accepted = false;\n    }\n  }\n\n  if (accepted) {\n    record.currentExports = moduleExports;\n  }\n\n  hotModuleRegistry.set(moduleId, record);\n  return accepted;\n};\n\n';

// SHA-256 of the hmr.js each scaffold shipped through 0.1.58: the SSG client
// (with the reload marker) and the SPA/full client.
const LEGACY_CLIENT_HASHES = new Set([
  '95389ea63898e0058a63ab9edf75e81eba54ef0da0ecf5366ef96adb00cecac7',
  'a081b7640499da3ebf9d80035b85852cc33434c81bd6b164b54a171f51ad48c5',
]);

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

export function usesLegacyHotModuleHooks(source: string): boolean {
  return LEGACY_HOOK_PATTERN.test(source);
}

export function migrateHotModuleRegistry(source: string): HotModuleMigration {
  if (!usesLegacyHotModuleHooks(source)) {
    return { kind: 'unchanged' };
  }

  const types = locateSpan(source, TYPES_START, TYPES_END);
  const registry = locateSpan(source, REGISTRY_START, REGISTRY_END);
  if (!types || !registry || types.end > registry.start) {
    return customized('its registry is not laid out the way the scaffold wrote it');
  }
  if (normalizeNewlines(source.slice(types.start, types.end)) !== LEGACY_TYPES_BLOCK) {
    return customized('its hot-module types block differs from the scaffold');
  }
  if (normalizeNewlines(source.slice(registry.start, registry.end)) !== LEGACY_REGISTRY_BLOCK) {
    return customized('its registry block differs from the scaffold');
  }

  const remainder =
    source.slice(0, types.start) +
    source.slice(types.end, registry.start) +
    source.slice(registry.end);
  const stillUsed = REMOVED_DEFINITIONS.find((name) => new RegExp(`\\b${name}\\b`).test(remainder));
  if (stillUsed) {
    return customized(`code outside the registry still uses ${stillUsed}`);
  }
  if (usesLegacyHotModuleHooks(remainder)) {
    return customized('code outside the registry still refers to the old hooks');
  }

  const rewritten =
    source.slice(0, types.start) +
    HOT_MODULE_REGISTRATION +
    source.slice(types.end, registry.start) +
    source.slice(registry.end);
  return { kind: 'rewritten', source: rewritten };
}

export function classifyHmrClient(source: string, current: string): HmrClientKind {
  const normalized = normalizeNewlines(source);
  if (normalized === normalizeNewlines(current)) {
    return 'current';
  }
  return LEGACY_CLIENT_HASHES.has(sha256(normalized)) ? 'legacy' : 'custom';
}

// Markers must sit at the start of a line so a declaration with an added
// modifier (`export type HotAsset = {`) reads as customized, not as the
// scaffold's own line with something in front of it.
function locateSpan(
  source: string,
  startMarker: string,
  endMarker: string,
): { readonly start: number; readonly end: number } | null {
  const starts = lineStarts(source, startMarker);
  if (starts.length !== 1) {
    return null;
  }
  const start = starts[0] ?? -1;
  const ends = lineStarts(source, endMarker).filter((index) => index > start);
  if (ends.length !== 1) {
    return null;
  }
  return { start, end: ends[0] ?? -1 };
}

function lineStarts(source: string, marker: string): number[] {
  const found: number[] = [];
  let index = source.indexOf(marker);
  while (index >= 0) {
    if (index === 0 || source[index - 1] === '\n') {
      found.push(index);
    }
    index = source.indexOf(marker, index + 1);
  }
  return found;
}

function normalizeNewlines(value: string): string {
  return value.replaceAll('\r\n', '\n');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function customized(reason: string): HotModuleMigration {
  return { kind: 'customized', reason };
}
