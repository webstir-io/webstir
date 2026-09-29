// A page can take hot updates in development: it registers handlers, and Webstir's dev client
// (served at /hmr.js in `webstir watch`) runs them. In production nothing reads the registrations,
// so this is a few bytes and no behaviour.

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

/** Registers a module's hot-update handlers: `registerHotModule(import.meta.url, { accept, dispose })`. */
export function registerHotModule(moduleId: string, handlers: HotModuleHandlers): void {
  const w = window as Window & { __webstirHotModules?: HotModuleRegistration[] };
  w.__webstirHotModules ??= [];
  w.__webstirHotModules.push({ moduleId, handlers });
}
