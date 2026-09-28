import { runApiWatch } from './api-watch.ts';
import { materializeRepoLocalWorkspaceDependencies } from './external-workspace.ts';
import { runFrontendWatch } from './frontend-watch.ts';
import { runFullWatch } from './full-watch.ts';
import type { WorkspaceDescriptor } from './types.ts';
import { readWorkspaceDescriptor } from './workspace.ts';
import { acquireWorkspaceWatchLock } from './workspace-lock.ts';

interface WatchStream {
  write(message: string): void;
}

export interface WatchIo {
  readonly stdout: WatchStream;
  readonly stderr: WatchStream;
}

export interface WatchOptions {
  readonly host?: string;
  readonly port?: number;
  readonly verbose?: boolean;
  readonly env?: Record<string, string | undefined>;
}

export interface RunWatchOptions extends WatchOptions {
  readonly workspaceRoot: string;
  readonly io?: WatchIo;
}

const defaultIo: WatchIo = {
  stdout: {
    write(message) {
      process.stdout.write(message);
    },
  },
  stderr: {
    write(message) {
      process.stderr.write(message);
    },
  },
};

export async function runWatch(options: RunWatchOptions): Promise<void> {
  const io = options.io ?? defaultIo;
  const workspace = await readWorkspaceDescriptor(options.workspaceRoot);
  const watchLock = await acquireWorkspaceWatchLock(workspace.root);

  try {
    await materializeRepoLocalWorkspaceDependencies(options.workspaceRoot);

    const { pages, server } = workspace.layers;
    if (pages && server) {
      await runFullWatch(workspace, options, io);
    } else if (server) {
      await runApiWatch(workspace, options, io);
    } else {
      await runFrontendWatch(workspace, options, io);
    }
  } finally {
    await watchLock.release();
  }
}
