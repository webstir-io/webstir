import net from 'node:net';
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';

export interface PublishedWorkspaceServerOptions {
  readonly workspaceRoot: string;
  readonly host?: string;
  readonly port?: number;
  readonly env?: Record<string, string | undefined>;
  readonly io?: DeploymentIo;
}

export interface PublishedWorkspaceServer {
  readonly origin: string;
  readonly mode: PublishedWorkspaceMode;
  stop(): Promise<void>;
}

export interface DeploymentIo {
  readonly stdout: {
    write(message: string): void;
  };
  readonly stderr: {
    write(message: string): void;
  };
}

export type PublishedWorkspaceMode = 'api' | 'full';

export interface BunServerLike {
  readonly port: number;
  stop(closeActiveConnections?: boolean): void;
}

export interface BunLike {
  serve(options: {
    readonly port: number;
    readonly hostname?: string;
    readonly idleTimeout?: number;
    fetch(request: Request): Response | Promise<Response>;
    error?(error: Error): Response | Promise<Response>;
  }): BunServerLike;
  file(pathname: string): Blob;
}

export const DEFAULT_PUBLIC_PORT = 8080;

export async function readPublishedWorkspaceMode(
  workspaceRoot: string,
): Promise<PublishedWorkspaceMode> {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');
  const source = await readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(source) as {
    webstir?: {
      mode?: string;
    };
  };
  const mode = packageJson.webstir?.mode;
  if (mode === 'api' || mode === 'full') {
    return mode;
  }

  throw new Error(
    `Published deploy only supports api and full workspaces. Received ${JSON.stringify(mode)} in ${packageJsonPath}.`,
  );
}

export async function assertExists(targetPath: string, label: string): Promise<void> {
  try {
    await access(targetPath);
  } catch {
    throw new Error(`Expected ${label} at ${targetPath}.`);
  }
}

export async function getOpenPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate an open port.'));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

export function textResponse(statusCode: number, body: string): Response {
  return new Response(body, {
    status: statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export function resolveRuntimeCommand(): string {
  if (typeof process.versions.bun === 'string') {
    return process.execPath;
  }

  return 'bun';
}

export function requireBunRuntime(): BunLike {
  const bun = (globalThis as typeof globalThis & { Bun?: BunLike }).Bun;
  if (!bun?.serve || !bun.file) {
    throw new Error('Published Webstir deploy requires Bun at runtime.');
  }

  return bun;
}

export const defaultIo: DeploymentIo = {
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
