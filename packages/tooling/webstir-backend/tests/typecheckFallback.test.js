import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { backendProvider } from '../dist/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A backend with no tsconfig.json of its own is type-checked with the package's settings.
for (const [name, source, fails] of [
  ['code that type-checks', 'export const port: number = Number(process.env.PORT ?? 0);\n', false],
  ['a type error', "export const port: number = 'not a number';\n", true],
]) {
  test(`a backend without a tsconfig is type-checked with the package's settings: ${name}`, async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-backend-typecheck-'));
    try {
      await fs.mkdir(path.join(workspace, 'src', 'backend'), { recursive: true });
      await fs.writeFile(path.join(workspace, 'src', 'backend', 'index.ts'), source);
      // The app's installed types, as in a real app.
      await fs.symlink(
        path.join(packageRoot, 'node_modules'),
        path.join(workspace, 'node_modules'),
      );
      const build = () =>
        backendProvider.build({
          workspaceRoot: workspace,
          env: {
            WEBSTIR_MODULE_MODE: 'publish',
            PATH: `${path.join(packageRoot, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH ?? ''}`,
          },
          incremental: false,
        });
      if (fails) {
        await assert.rejects(build, /TS2322/);
      } else {
        await build();
      }
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
}
