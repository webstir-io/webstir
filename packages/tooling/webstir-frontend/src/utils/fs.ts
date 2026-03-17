import path from 'node:path';
import type { Stats } from 'node:fs';
import { lstat, mkdir, readdir, rm, stat as statFs } from 'node:fs/promises';

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

    throw new Error('[webstir-frontend] Bun runtime is required for package-level IO.');
}

export async function ensureDir(targetPath: string): Promise<void> {
    await mkdir(targetPath, { recursive: true });
}

export async function emptyDir(targetPath: string): Promise<void> {
    await rm(targetPath, { recursive: true, force: true });
    await mkdir(targetPath, { recursive: true });
}

export async function remove(targetPath: string): Promise<void> {
    await rm(targetPath, { recursive: true, force: true });
}

export async function copy(source: string, destination: string): Promise<void> {
    const sourceInfo = await lstat(source);

    if (sourceInfo.isDirectory()) {
        await ensureDir(destination);
        const entries = await readdir(source, { withFileTypes: true });
        await Promise.all(
            entries.map((entry) =>
                copy(path.join(source, entry.name), path.join(destination, entry.name))
            )
        );
        return;
    }

    await ensureDir(path.dirname(destination));
    const bun = getBunRuntime();
    await bun.write(destination, bun.file(source));
}

export async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await statFs(targetPath);
        return true;
    } catch {
        return false;
    }
}

export async function stat(targetPath: string): Promise<Stats> {
    return await statFs(targetPath);
}

export async function readJson<T>(targetPath: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(targetPath)) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function writeJson(targetPath: string, data: unknown): Promise<void> {
    await writeFile(targetPath, JSON.stringify(data, undefined, 2));
}

export async function readFile(targetPath: string): Promise<string> {
    return await getBunRuntime().file(targetPath).text();
}

export async function readBinaryFile(targetPath: string): Promise<Uint8Array> {
    return new Uint8Array(await getBunRuntime().file(targetPath).arrayBuffer());
}

export async function writeFile(targetPath: string, contents: string): Promise<void> {
    await ensureDir(path.dirname(targetPath));
    await getBunRuntime().write(targetPath, contents);
}
