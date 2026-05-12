import { createServer } from 'node:net';

export type SpawnedProcess = ReturnType<typeof Bun.spawn>;

const PROCESS_STOP_TIMEOUT_MS = 5_000;
const OUTPUT_DRAIN_TIMEOUT_MS = 5_000;

export async function stopTrackedChildren(children: SpawnedProcess[]): Promise<void> {
  while (children.length > 0) {
    const child = children.pop();
    if (!child) {
      continue;
    }

    await stopSpawnedProcess(child);
  }
}

export async function stopSpawnedProcess(child: SpawnedProcess): Promise<void> {
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    child.exited.then(
      () => true,
      () => true,
    ),
    Bun.sleep(PROCESS_STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (stopped) {
    return;
  }

  child.kill('SIGKILL');
  await Promise.race([child.exited.catch(() => undefined), Bun.sleep(PROCESS_STOP_TIMEOUT_MS)]);
}

export function removeTrackedChild(children: SpawnedProcess[], child: SpawnedProcess): void {
  const childIndex = children.indexOf(child);
  if (childIndex >= 0) {
    children.splice(childIndex, 1);
  }
}

export async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to allocate a free TCP port.');
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return port;
}

export async function waitFor(assertion: () => Promise<void>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await Bun.sleep(150);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out after ${timeoutMs}ms.`);
}

export async function collectOutput(
  stream: ReadableStream<Uint8Array>,
  target: { text: string },
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      target.text += decoder.decode(value, { stream: true });
    }

    target.text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function settleOutputDrains(...drains: Promise<void>[]): Promise<void> {
  await Promise.race([Promise.allSettled(drains), Bun.sleep(OUTPUT_DRAIN_TIMEOUT_MS)]);
}

export function appendWatchLogs(error: unknown, stdout: string, stderr: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `${message}\n\nstdout:\n${tailOutput(stdout)}\n\nstderr:\n${tailOutput(stderr)}`,
  );
}

function tailOutput(text: string): string {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return '(empty)';
  }

  return normalized.slice(-4_000);
}
