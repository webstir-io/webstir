import { runApiWatch } from './api-watch.ts';
import { runFrontendWatch } from './frontend-watch.ts';
import { runFullWatch } from './full-watch.ts';
import type { WorkspaceDescriptor } from './types.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

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
  readonly hmrVerbose?: boolean;
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

  switch (workspace.mode) {
    case 'spa':
      await runFrontendWatch(workspace, options, io);
      return;
    case 'ssg':
      await runFrontendWatch(workspace, options, io);
      return;
    case 'api':
      await runApiWatch(workspace, options, io);
      return;
    case 'full':
      await runFullWatch(workspace, options, io);
      return;
    default:
      throwUnsupportedWatchMode(workspace);
  }
}

function throwUnsupportedWatchMode(workspace: WorkspaceDescriptor): never {
  throw new Error(
    `Watch currently supports spa, ssg, api, and full workspaces only. "${workspace.name}" is ${workspace.mode}.`
  );
}
