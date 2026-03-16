import { rename } from 'node:fs/promises';
import path from 'node:path';

import { frontendConfigSchema, type FrontendConfigInput } from './schema.js';
import { ensureDir, readFile, writeFile } from '../utils/fs.js';

export interface WriteManifestOptions {
    readonly outputPath: string;
    readonly data: FrontendConfigInput;
}

export async function writeConfigManifest(options: WriteManifestOptions): Promise<void> {
    const parsed = frontendConfigSchema.parse(options.data);
    const directory = path.dirname(options.outputPath);
    await ensureDir(directory);
    const serialized = JSON.stringify(parsed, undefined, 2);
    const tempPath = path.join(directory, `.webstir-frontend-${process.pid}-${Date.now()}.tmp`);
    await writeFile(tempPath, serialized);
    await rename(tempPath, options.outputPath);
}

export async function readConfigManifest(manifestPath: string): Promise<FrontendConfigInput> {
    const json = await readFile(manifestPath);
    const parsed = JSON.parse(json) as unknown;
    return frontendConfigSchema.parse(parsed);
}
