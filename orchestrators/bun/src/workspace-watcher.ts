import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';

export type WorkspaceWatchEvent =
  | { readonly type: 'change'; readonly path: string }
  | { readonly type: 'reload'; readonly path?: string; readonly paths?: readonly string[] };

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
  private readonly treeDirectories = new Set<string>();
  private readonly fileSnapshots = new Map<string, string>();
  private readonly pendingChanges = new Set<string>();
  private readonly pendingSyncs = new Map<string, NodeJS.Timeout>();
  private rootWatcher?: FSWatcher;
  private flushTimer?: NodeJS.Timeout;
  private reloadPending = false;
  private reloadPathUnknown = false;
  private readonly pendingReloadPaths = new Set<string>();

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
    const collected = await collectTreeEntries(root);
    const directories = collected.directories;
    const current = new Set(directories);
    this.syncTreeDirectories(root, current);
    this.syncFileSnapshots(root, collected.fileSnapshots);

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
          void this.handleRename(root, absolutePath);
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
    const resolvedPath = path.resolve(absolutePath);
    const baseName = path.basename(resolvedPath);
    if (IGNORED_DIRECTORIES.has(baseName)) {
      return;
    }

    try {
      const details = await stat(resolvedPath);
      if (details.isDirectory()) {
        this.queueReload(resolvedPath);
        this.scheduleTreeSync(root);
        return;
      }

      const snapshot = createFileSnapshot(details);
      const previousSnapshot = this.fileSnapshots.get(resolvedPath);
      this.fileSnapshots.set(resolvedPath, snapshot);
      if (previousSnapshot === snapshot) {
        return;
      }

      this.queueChange(resolvedPath);
    } catch {
      this.fileSnapshots.delete(resolvedPath);
      this.queueReload(resolvedPath);
      this.scheduleTreeSync(root);
    }
  }

  private async handleRename(root: string, absolutePath: string | undefined): Promise<void> {
    if (!absolutePath) {
      this.queueReload(root);
      this.scheduleTreeSync(root);
      return;
    }

    const resolvedPath = path.resolve(absolutePath);
    const baseName = path.basename(resolvedPath);
    if (IGNORED_DIRECTORIES.has(baseName)) {
      return;
    }

    try {
      const details = await stat(resolvedPath);
      if (details.isDirectory()) {
        if (!this.treeDirectories.has(resolvedPath)) {
          this.queueReload(resolvedPath);
        }
        this.scheduleTreeSync(root);
        return;
      }

      if (!details.isFile()) {
        this.scheduleTreeSync(root);
        return;
      }

      const snapshot = createFileSnapshot(details);
      const previousSnapshot = this.fileSnapshots.get(resolvedPath);
      this.fileSnapshots.set(resolvedPath, snapshot);
      if (previousSnapshot !== snapshot) {
        this.queueReload(resolvedPath);
      }
      this.scheduleTreeSync(root);
    } catch {
      const knownFile = this.fileSnapshots.delete(resolvedPath);
      const knownDirectory = this.treeDirectories.has(resolvedPath);
      if (knownFile || knownDirectory) {
        this.queueReload(resolvedPath);
      }
      this.scheduleTreeSync(root);
    }
  }

  private syncFileSnapshots(root: string, nextSnapshots: ReadonlyMap<string, string>): void {
    for (const filePath of Array.from(this.fileSnapshots.keys())) {
      if (isWithinDirectory(filePath, root) && !nextSnapshots.has(filePath)) {
        this.fileSnapshots.delete(filePath);
      }
    }

    for (const [filePath, snapshot] of nextSnapshots) {
      this.fileSnapshots.set(filePath, snapshot);
    }
  }

  private syncTreeDirectories(root: string, currentDirectories: ReadonlySet<string>): void {
    for (const directory of Array.from(this.treeDirectories)) {
      if (isDirectoryOrDescendant(directory, root) && !currentDirectories.has(directory)) {
        this.treeDirectories.delete(directory);
      }
    }

    for (const directory of currentDirectories) {
      this.treeDirectories.add(directory);
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
    if (filePath) {
      this.pendingReloadPaths.add(path.resolve(filePath));
    } else {
      this.reloadPathUnknown = true;
      this.pendingReloadPaths.clear();
    }
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
      const reloadPaths = this.reloadPathUnknown ? [] : Array.from(this.pendingReloadPaths).sort();
      this.reloadPending = false;
      this.reloadPathUnknown = false;
      this.pendingReloadPaths.clear();
      this.onEvent(createReloadEvent(reloadPaths));
      return;
    }

    const changedPaths = Array.from(this.pendingChanges).sort();
    this.pendingChanges.clear();

    if (changedPaths.length === 1) {
      this.onEvent({ type: 'change', path: changedPaths[0] });
      return;
    }

    if (changedPaths.length > 1) {
      this.onEvent(createReloadEvent(changedPaths));
    }
  }
}

function createReloadEvent(paths: readonly string[]): WorkspaceWatchEvent {
  if (paths.length === 0) {
    return { type: 'reload' };
  }

  if (paths.length === 1) {
    return { type: 'reload', path: paths[0], paths };
  }

  return { type: 'reload', paths };
}

interface CollectedTreeEntries {
  readonly directories: readonly string[];
  readonly fileSnapshots: ReadonlyMap<string, string>;
}

async function collectTreeEntries(root: string): Promise<CollectedTreeEntries> {
  try {
    const details = await stat(root);
    if (!details.isDirectory()) {
      return {
        directories: [],
        fileSnapshots: new Map(),
      };
    }
  } catch {
    return {
      directories: [],
      fileSnapshots: new Map(),
    };
  }

  const directories: string[] = [];
  const fileSnapshots = new Map<string, string>();
  const stack = [path.resolve(root)];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    directories.push(current);

    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          stack.push(entryPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const details = await stat(entryPath);
        fileSnapshots.set(path.resolve(entryPath), createFileSnapshot(details));
      } catch {
        // The file can disappear between readdir and stat; the next watcher event will resync.
      }
    }
  }

  return { directories, fileSnapshots };
}

function createFileSnapshot(details: { readonly size: number; readonly mtimeMs: number }): string {
  return `${details.size}:${details.mtimeMs}`;
}

function isWithinDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isDirectoryOrDescendant(filePath: string, directory: string): boolean {
  return filePath === directory || isWithinDirectory(filePath, directory);
}
