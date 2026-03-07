import net from 'node:net';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadLineInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

import { resolveRuntimeCommand } from './runtime.ts';

interface RuntimeStream {
  write(message: string): void;
}

export interface BackendRuntimeIo {
  readonly stdout: RuntimeStream;
  readonly stderr: RuntimeStream;
}

export interface BackendRuntimeSupervisorOptions {
  readonly workspaceRoot: string;
  readonly buildRoot: string;
  readonly host: string;
  readonly port?: number;
  readonly env?: Record<string, string | undefined>;
  readonly io: BackendRuntimeIo;
}

interface RuntimeProcessRecord {
  readonly child: ChildProcessWithoutNullStreams;
  readonly stdoutReader: ReadLineInterface;
  readonly stderrReader: ReadLineInterface;
  readonly exitPromise: Promise<number | null>;
  expectedExit: boolean;
}

const DEFAULT_API_PORT = 4321;
const READY_TIMEOUT_MS = 15_000;
const READY_POLL_MS = 100;
const SOCKET_TIMEOUT_MS = 200;

export class BackendRuntimeSupervisor {
  private readonly workspaceRoot: string;
  private readonly entryFile: string;
  private readonly displayHost: string;
  private readonly env?: Record<string, string | undefined>;
  private readonly io: BackendRuntimeIo;
  private current?: RuntimeProcessRecord;
  private queuedRestart: Promise<void> = Promise.resolve();
  private isStopping = false;
  private readonly requestedPort?: number;
  private resolvedPort?: number;

  public constructor(options: BackendRuntimeSupervisorOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.entryFile = path.join(path.resolve(options.buildRoot), 'index.js');
    this.displayHost = normalizeDisplayHost(options.host);
    this.env = options.env;
    this.io = options.io;
    this.requestedPort = options.port;
  }

  public async restart(): Promise<void> {
    return await this.enqueue(async () => {
      await this.restartInternal();
    });
  }

  public async stop(): Promise<void> {
    this.isStopping = true;
    await this.enqueue(async () => {
      await this.stopCurrentProcess();
    });
  }

  public getOrigin(): string {
    const port = this.resolvedPort ?? this.requestedPort ?? DEFAULT_API_PORT;
    return `http://${this.displayHost}:${port}`;
  }

  private async restartInternal(): Promise<void> {
    if (this.isStopping) {
      return;
    }

    const port = this.resolvedPort ?? (await resolvePort(this.requestedPort));
    this.resolvedPort = port;
    await this.stopCurrentProcess();
    await this.startProcess(port);
  }

  private async enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.queuedRestart.catch(() => undefined).then(task);
    this.queuedRestart = next.catch(() => undefined);
    await next;
  }

  private async startProcess(port: number): Promise<void> {
    const child = spawn(resolveRuntimeCommand(), [this.entryFile], {
      cwd: this.workspaceRoot,
      env: {
        ...process.env,
        ...this.env,
        PORT: String(port),
        API_BASE_URL: `http://${this.displayHost}:${port}`,
        NODE_ENV: this.env?.NODE_ENV ?? process.env.NODE_ENV ?? 'development',
      },
      stdio: 'pipe',
    });

    const exitPromise = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code));
    });

    const onStdoutLine = (line: string) => {
      this.io.stdout.write(`[backend] ${line}\n`);
    };

    const onStderrLine = (line: string) => {
      this.io.stderr.write(`[backend] ${line}\n`);
    };

    const stdoutReader = createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdoutReader.on('line', onStdoutLine);
    const stderrReader = createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderrReader.on('line', onStderrLine);

    const processRecord: RuntimeProcessRecord = {
      child,
      stdoutReader,
      stderrReader,
      exitPromise,
      expectedExit: false,
    };
    this.current = processRecord;

    let ready = false;

    exitPromise.then((code) => {
      if (!ready) {
        return;
      } else if (!processRecord.expectedExit && !this.isStopping && this.current === processRecord) {
        this.io.stderr.write(`[webstir-bun] backend runtime exited unexpectedly with code ${code ?? 'null'}.\n`);
      }
    }).finally(() => {
      if (this.current === processRecord) {
        this.current = undefined;
      }
      stdoutReader.close();
      stderrReader.close();
    });

    try {
      await waitForRuntimeReady(port, exitPromise);
      ready = true;
    } catch (error) {
      processRecord.expectedExit = true;
      child.kill('SIGTERM');
      await exitPromise.catch(() => undefined);
      throw error;
    }
  }

  private async stopCurrentProcess(): Promise<void> {
    const current = this.current;
    if (!current) {
      return;
    }

    current.expectedExit = true;
    current.child.kill('SIGTERM');
    await current.exitPromise.catch(() => undefined);
    if (this.current === current) {
      this.current = undefined;
    }
  }
}

async function resolvePort(requestedPort?: number): Promise<number> {
  if (requestedPort !== undefined) {
    if (!(await isPortAvailable(requestedPort))) {
      throw new Error(`Port ${requestedPort} is already in use.`);
    }

    return requestedPort;
  }

  return await findOpenPort(DEFAULT_API_PORT);
}

async function findOpenPort(startPort: number, attempts = 20): Promise<number> {
  let candidate = startPort;
  for (let index = 0; index < attempts; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortAvailable(candidate)) {
      return candidate;
    }
    candidate += 1;
  }

  throw new Error(`Unable to find an open port starting at ${startPort}.`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      server.close(() => resolve(false));
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function normalizeDisplayHost(host: string): string {
  return host === '0.0.0.0' ? '127.0.0.1' : host;
}

async function waitForRuntimeReady(
  port: number,
  exitPromise: Promise<number | null>
): Promise<void> {
  const abortController = new AbortController();

  try {
    await Promise.race([
      waitForPortOpen(port, abortController.signal),
      exitPromise.then((code) => {
        throw new Error(`Backend runtime exited before it became ready (code ${code ?? 'null'}).`);
      }),
      delay(READY_TIMEOUT_MS).then(() => {
        throw new Error(`Backend runtime did not become ready within ${READY_TIMEOUT_MS}ms.`);
      }),
    ]);
  } finally {
    abortController.abort();
  }
}

async function waitForPortOpen(port: number, signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    if (await canConnectToPort(port)) {
      return;
    }

    try {
      await delay(READY_POLL_MS, undefined, { signal });
    } catch (error) {
      if (signal.aborted) {
        return;
      }

      throw error;
    }
  }
}

function canConnectToPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });

    const settle = (value: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(SOCKET_TIMEOUT_MS, () => settle(false));
  });
}
