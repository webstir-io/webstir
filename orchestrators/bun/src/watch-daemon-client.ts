import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createWorkspaceRuntimeEnv, resolveRuntimeCommand } from './runtime.ts';
import { parseStructuredDiagnosticLine, type StructuredDiagnosticPayload } from './watch-events.ts';
import { ensureLocalPackageArtifacts } from './providers.ts';

type WatchDaemonCommand =
  | { readonly type: 'start' }
  | { readonly type: 'change'; readonly path: string }
  | { readonly type: 'reload' }
  | { readonly type: 'shutdown' };

export interface FrontendWatchDaemonClientOptions {
  readonly workspaceRoot: string;
  readonly verbose?: boolean;
  readonly hmrVerbose?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly onLine?: (line: string) => void;
  readonly onErrorLine?: (line: string) => void;
  readonly onDiagnostic?: (payload: StructuredDiagnosticPayload) => void;
}

export class FrontendWatchDaemonClient {
  private readonly workspaceRoot: string;
  private readonly verbose: boolean;
  private readonly hmrVerbose: boolean;
  private readonly env?: Record<string, string | undefined>;
  private readonly onLine?: (line: string) => void;
  private readonly onErrorLine?: (line: string) => void;
  private readonly onDiagnostic?: (payload: StructuredDiagnosticPayload) => void;
  private child?: ChildProcessWithoutNullStreams;
  private stdoutReader?: ReadLineInterface;
  private stderrReader?: ReadLineInterface;
  private exitPromise?: Promise<number | null>;
  private isStopping = false;

  public constructor(options: FrontendWatchDaemonClientOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.verbose = options.verbose ?? false;
    this.hmrVerbose = options.hmrVerbose ?? false;
    this.env = options.env;
    this.onLine = options.onLine;
    this.onErrorLine = options.onErrorLine;
    this.onDiagnostic = options.onDiagnostic;
  }

  public async start(): Promise<void> {
    if (this.child) {
      return;
    }

    await ensureLocalPackageArtifacts();
    const frontendCliPath = fileURLToPath(import.meta.resolve('@webstir-io/webstir-frontend/cli'));
    const args = [
      frontendCliPath,
      'watch-daemon',
      '--workspace',
      this.workspaceRoot,
      '--no-auto-start',
    ];

    if (this.verbose) {
      args.push('--verbose');
    }

    if (this.hmrVerbose) {
      args.push('--hmr-verbose');
    }

    const child = spawn(resolveRuntimeCommand(), args, {
      cwd: this.workspaceRoot,
      env: createWorkspaceRuntimeEnv(this.workspaceRoot, 'build', this.env),
      stdio: 'pipe',
    });

    this.child = child;
    this.exitPromise = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code));
    });

    this.stdoutReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.stdoutReader.on('line', (line) => {
      const diagnostic = parseStructuredDiagnosticLine(line);
      if (diagnostic) {
        this.onDiagnostic?.(diagnostic);
        return;
      }

      this.onLine?.(line);
    });

    this.stderrReader = createInterface({ input: child.stderr, crlfDelay: Infinity });
    this.stderrReader.on('line', (line) => {
      this.onErrorLine?.(line);
    });
  }

  public async sendStart(): Promise<void> {
    await this.send({ type: 'start' });
  }

  public async sendChange(filePath: string): Promise<void> {
    await this.send({ type: 'change', path: filePath });
  }

  public async sendReload(): Promise<void> {
    await this.send({ type: 'reload' });
  }

  public async stop(): Promise<number | null> {
    if (!this.child || !this.exitPromise) {
      return 0;
    }

    if (!this.isStopping) {
      this.isStopping = true;
      try {
        await this.send({ type: 'shutdown' });
      } catch {
        // Fall through to best-effort teardown.
      }

      this.child.stdin.end();
    }

    const code = await this.exitPromise;
    this.cleanup();
    return code;
  }

  public async waitForExit(): Promise<number | null> {
    if (!this.exitPromise) {
      throw new Error('Frontend watch daemon has not started.');
    }

    const code = await this.exitPromise;
    this.cleanup();
    return code;
  }

  private async send(command: WatchDaemonCommand): Promise<void> {
    if (!this.child || !this.child.stdin.writable) {
      throw new Error('Frontend watch daemon is not running.');
    }

    await new Promise<void>((resolve, reject) => {
      this.child!.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private cleanup(): void {
    this.stdoutReader?.close();
    this.stderrReader?.close();
    this.stdoutReader = undefined;
    this.stderrReader = undefined;
    this.child = undefined;
    this.exitPromise = undefined;
    this.isStopping = false;
  }
}
