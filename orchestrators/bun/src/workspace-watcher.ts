import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';

export type WorkspaceWatchEvent =
  | { readonly type: 'change'; readonly path: string }
  | { readonly type: 'reload'; readonly path?: string };

export interface WorkspaceWatcherOptions {
  readonly workspaceRoot: string;
  readonly debounceMs?: number;
  readonly onEvent: (event: WorkspaceWatchEvent) => void;
}

const ROOT_TRIGGER_FILES = new Set(['package.json', 'base.tsconfig.json', 'types.global.d.ts']);
const IGNORED_DIRECTORIES = new Set(['.git', '.webstir', 'build', 'dist', 'node_modules']);

export class WorkspaceWatcher {
  private readonly workspaceRoot: string;
  private readonly treeRoots: readonly string[];
  private readonly onEvent: (event: WorkspaceWatchEvent) => void;
  private readonly debounceMs: number;
  private readonly treeWatchers = new Map<string, FSWatcher>();
  private readonly pendingChanges = new Set<string>();
  private readonly pendingSyncs = new Map<string, NodeJS.Timeout>();
  private rootWatcher?: FSWatcher;
  private flushTimer?: NodeJS.Timeout;
  private reloadPending = false;
  private reloadPath?: string;

  public constructor(options: WorkspaceWatcherOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.treeRoots = [path.join(this.workspaceRoot, 'src'), path.join(this.workspaceRoot, 'types')];
    this.onEvent = options.onEvent;
    this.debounceMs = options.debounceMs ?? 75;
  }

  public async start(): Promise<void> {
    this.watchRootDirectory();
    for (const root of this.treeRoots) {
      await this.syncTree(root);
    }
  }

  public async stop(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    for (const timer of this.pendingSyncs.values()) {
      clearTimeout(timer);
    }
    this.pendingSyncs.clear();

    if (this.rootWatcher) {
      this.rootWatcher.close();
      this.rootWatcher = undefined;
    }

    for (const watcher of this.treeWatchers.values()) {
      watcher.close();
    }
    this.treeWatchers.clear();
  }

  private watchRootDirectory(): void {
    this.rootWatcher = watch(this.workspaceRoot, (_eventType, filename) => {
      if (!filename) {
        return;
      }

      const entryName = filename.toString();
      if (ROOT_TRIGGER_FILES.has(entryName)) {
        this.queueReload(path.join(this.workspaceRoot, entryName));
        return;
      }

      if (entryName === 'src' || entryName === 'types') {
        this.scheduleTreeSync(path.join(this.workspaceRoot, entryName));
      }
    });
  }

  private scheduleTreeSync(root: string): void {
    const existing = this.pendingSyncs.get(root);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.pendingSyncs.delete(root);
      void this.syncTree(root);
    }, this.debounceMs);

    this.pendingSyncs.set(root, timer);
  }

  private async syncTree(root: string): Promise<void> {
    const directories = await collectDirectories(root);
    const current = new Set(directories);

    for (const directory of directories) {
      if (this.treeWatchers.has(directory)) {
        continue;
      }

      this.watchDirectory(directory, root);
    }

    for (const watchedDirectory of Array.from(this.treeWatchers.keys())) {
      if (
        watchedDirectory !== root &&
        watchedDirectory.startsWith(`${root}${path.sep}`) &&
        !current.has(watchedDirectory)
      ) {
        this.treeWatchers.get(watchedDirectory)?.close();
        this.treeWatchers.delete(watchedDirectory);
      }
    }

    if (!current.has(root) && this.treeWatchers.has(root)) {
      this.treeWatchers.get(root)?.close();
      this.treeWatchers.delete(root);
    }
  }

  private watchDirectory(directory: string, root: string): void {
    try {
      const watcher = watch(directory, (eventType, filename) => {
        const absolutePath = filename ? path.join(directory, filename.toString()) : undefined;

        if (eventType === 'rename') {
          this.queueReload(absolutePath);
          this.scheduleTreeSync(root);
          return;
        }

        if (!absolutePath) {
          this.queueReload(root);
          this.scheduleTreeSync(root);
          return;
        }

        void this.handleFileChange(root, absolutePath);
      });

      watcher.once('error', () => {
        watcher.close();
        this.treeWatchers.delete(directory);
        this.scheduleTreeSync(root);
      });

      this.treeWatchers.set(directory, watcher);
    } catch {
      // Ignore transient directories that vanish before the watcher attaches.
    }
  }

  private async handleFileChange(root: string, absolutePath: string): Promise<void> {
    const baseName = path.basename(absolutePath);
    if (IGNORED_DIRECTORIES.has(baseName)) {
      return;
    }

    this.scheduleTreeSync(root);

    try {
      const details = await stat(absolutePath);
      if (details.isDirectory()) {
        this.queueReload(absolutePath);
        return;
      }

      this.queueChange(absolutePath);
    } catch {
      this.queueReload(absolutePath);
    }
  }

  private queueChange(filePath: string): void {
    if (this.reloadPending) {
      return;
    }

    this.pendingChanges.add(path.resolve(filePath));
    this.scheduleFlush();
  }

  private queueReload(filePath?: string): void {
    this.reloadPending = true;
    this.reloadPath = filePath ? path.resolve(filePath) : undefined;
    this.pendingChanges.clear();
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, this.debounceMs);
  }

  private flush(): void {
    if (this.reloadPending) {
      const reloadPath = this.reloadPath;
      this.reloadPending = false;
      this.reloadPath = undefined;
      this.onEvent(reloadPath ? { type: 'reload', path: reloadPath } : { type: 'reload' });
      return;
    }

    for (const filePath of Array.from(this.pendingChanges).sort()) {
      this.onEvent({ type: 'change', path: filePath });
    }
    this.pendingChanges.clear();
  }
}

async function collectDirectories(root: string): Promise<readonly string[]> {
  try {
    const details = await stat(root);
    if (!details.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const directories: string[] = [];
  const stack = [path.resolve(root)];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    directories.push(current);

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }

      stack.push(path.join(current, entry.name));
    }
  }

  return directories;
}
