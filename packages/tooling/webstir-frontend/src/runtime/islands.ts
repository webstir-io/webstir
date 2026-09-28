/** What the islands loader offers the page; see `islands/runtime.ts`. */
export interface IslandControls {
  mountWithin(root: ParentNode): void;
  unmountWithin(root: ParentNode): Promise<void>;
  /** Mounts every island with this name again from fresh code, where it is. */
  remount(name: string): Promise<void>;
}

export const ISLANDS = Symbol.for('webstir.islands');
/** Marks the stylesheets islands load, which stay in the head across navigations. */
export const ISLAND_STYLES_ATTRIBUTE = 'data-webstir-island-styles';

/** The page's islands, when its loader has run; client-nav and `render(data)` keep them in step. */
export function islandControls(): IslandControls | undefined {
  return (globalThis as Record<symbol, unknown>)[ISLANDS] as IslandControls | undefined;
}
