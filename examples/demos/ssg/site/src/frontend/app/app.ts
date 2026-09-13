import './scripts/components/menu.js';
import './scripts/components/theme.js';

// Global app initialization

// Pages can opt into hot module updates. During development the dev server's
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

import "./scripts/features/client-nav.js";
import "./scripts/features/search.js";
import "./scripts/features/content-nav.js";
