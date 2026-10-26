import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed:\n${stdout}\n${stderr}`);
  }
}

test('published contract imports and declarations work with strict Zod 4 consumers', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'webstir-contract-consumer-'));
  try {
    await run([process.execPath, 'pm', 'pack', '--destination', root], packageRoot);
    const tarball = (await readdir(root)).find((name) => name.endsWith('.tgz'));
    if (!tarball) throw new Error('Package pack did not produce a tarball.');
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: {
          '@webstir-io/module-contract': `file:${path.join(root, tarball)}`,
          zod: '^4.6.6',
          '@types/node': '20.19.21',
        },
      }),
    );
    await run([process.execPath, 'install', '--ignore-scripts'], root);
    await writeFile(
      path.join(root, 'consumer.ts'),
      `
import { z } from 'zod';
import { defineRoute, defineView, type RequestContext, type SSRContext } from '@webstir-io/module-contract';
import * as render from '@webstir-io/module-contract/render';
import * as pages from '@webstir-io/module-contract/page-routes';
import * as workspace from '@webstir-io/module-contract/workspace';
import * as navigation from '@webstir-io/module-contract/client-nav';
const params = z.object({ id: z.string() });
const response = z.object({ id: z.string() });
const route = defineRoute<RequestContext, typeof params, undefined, undefined, typeof response>({
  definition: { name: 'read', method: 'GET', path: '/items/:id' },
  schemas: { params, response },
  handler: (ctx) => ({ status: 200, body: { id: ctx.params.id } }),
});
const view = defineView<SSRContext, typeof params, typeof response>({
  definition: { name: 'item', path: '/items/:id', page: 'item' },
  params, data: response, load: (ctx) => ({ id: ctx.params.id }),
});
// @ts-expect-error The removed adapter is intentionally absent from root declarations.
import { fromTsRestRouter } from '@webstir-io/module-contract';
// @ts-expect-error The removed subpath is intentionally absent from package exports.
import type { FromTsRestRouteOptions } from '@webstir-io/module-contract/ts-rest';
export { route, view, render, pages, workspace, navigation };
`,
    );
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
        },
        files: ['consumer.ts'],
      }),
    );
    await run(
      [
        process.execPath,
        path.join(packageRoot, 'node_modules/typescript/bin/tsc'),
        '-p',
        'tsconfig.json',
      ],
      root,
    );
    await writeFile(
      path.join(root, 'consumer.mjs'),
      `
import assert from 'node:assert/strict';
import * as contract from '@webstir-io/module-contract';
assert.equal(typeof contract.defineRoute, 'function');
assert.equal('fromTsRestRoute' in contract, false);
await assert.rejects(import('@webstir-io/module-contract/ts-rest'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
`,
    );
    await run(['node', 'consumer.mjs'], root);
    const installed = JSON.parse(
      await readFile(
        path.join(root, 'node_modules/@webstir-io/module-contract/package.json'),
        'utf8',
      ),
    );
    expect(installed.dependencies['@ts-rest/core']).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
