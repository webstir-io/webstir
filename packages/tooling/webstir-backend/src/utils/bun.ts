type BunFileLike = {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

interface BunLike {
  file(path: string): BunFileLike;
  write(path: string, data: string | ArrayBufferView | Blob | BunFileLike): Promise<number>;
}

function getBunRuntime(): BunLike {
  const runtime = globalThis as typeof globalThis & { Bun?: BunLike };
  if (typeof runtime.Bun?.file === 'function' && typeof runtime.Bun?.write === 'function') {
    return runtime.Bun;
  }

  throw new Error('[webstir-backend] Bun runtime is required for package-level IO.');
}

export async function readTextFile(filePath: string): Promise<string> {
  return await getBunRuntime().file(filePath).text();
}

export async function writeTextFile(filePath: string, contents: string): Promise<void> {
  await getBunRuntime().write(filePath, contents);
}
