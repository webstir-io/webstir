import { existsSync, readFileSync } from 'node:fs';
import type { WorkspaceLayers } from '@webstir-io/module-contract/workspace';
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
  /** What the published app is made of; it always has a server. */
  readonly layers: WorkspaceLayers;
  /**
   * Lets requests in flight finish, within SHUTDOWN_TIMEOUT, then stops the app server. With
   * `now`, closes every connection and stops both at once.
   */
  stop(how?: { readonly now?: boolean }): Promise<void>;
}

export interface DeploymentIo {
  readonly stdout: {
    write(message: string): void;
  };
  readonly stderr: {
    write(message: string): void;
  };
}

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

/**
 * The published app's layers, as publish recorded them in build/published-layers.json, since a
 * deploy image carries only the published output (no src/). Output published before that record
 * existed is read from its files: a server is build/backend/index.js, pages are dist/frontend.
 */
export function readPublishedLayers(workspaceRoot: string): WorkspaceLayers {
  const recordPath = path.join(workspaceRoot, 'build', 'published-layers.json');
  const record = existsSync(recordPath)
    ? (JSON.parse(readFileSync(recordPath, 'utf8')) as Partial<WorkspaceLayers>)
    : undefined;
  const layers = {
    pages: record
      ? record.pages === true
      : existsSync(path.join(workspaceRoot, 'dist', 'frontend')),
    server: record
      ? record.server === true
      : existsSync(path.join(workspaceRoot, 'build', 'backend', 'index.js')),
  };
  if (!layers.server) {
    throw new Error(
      `Published deploy runs the app's server, and ${workspaceRoot} has none (build/backend/index.js); run webstir publish first.`,
    );
  }
  return layers;
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
