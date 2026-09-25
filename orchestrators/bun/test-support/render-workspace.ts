import { expect } from 'bun:test';
import path from 'node:path';
import { cp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';

import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, type DemoWorkspaceCopy } from './demo-workspace.ts';
import { getFreePort, waitFor } from './watch.ts';

const DESIGN_FIXTURE = path.join(
  repoRoot,
  'packages',
  'tooling',
  'webstir-frontend',
  'tests',
  'fixtures',
  'render-clients',
  'src',
  'frontend',
);

export const CLIENTS_DATA_SCHEMA = [
  'z.object({',
  '  nav: z.object({',
  "    proposals: z.literal('page').nullable(),",
  "    clients: z.object({ current: z.literal('page').nullable() }).nullable(),",
  '  }),',
  '  clients: z.array(z.object({ name: z.string(), href: z.string() })),',
  '  create: z.object({',
  '    open: z.boolean(),',
  '    values: z.object({ name: z.string().optional(), slug: z.string().optional() }),',
  '    issues: z.object({ form: z.string().optional(), name: z.string().optional(), slug: z.string().optional() }),',
  '  }),',
  '})',
].join('\n');

/** A copy of the full demo that can import zod from its backend module. */
export async function copyFullWorkspace(copies: DemoWorkspaceCopy[]): Promise<string> {
  const copy = await copyDemoWorkspace('full', 'webstir-render-');
  copies.push(copy);
  const workspace = copy.workspaceRoot;
  await mkdir(path.join(workspace, 'node_modules'), { recursive: true });
  await symlink(
    path.join(packageRoot, 'node_modules', 'zod'),
    path.join(workspace, 'node_modules', 'zod'),
  );
  return workspace;
}

/** Copies the DESIGN.md clients page and its sidebar partial into the workspace. */
export async function copyDesignClientsPage(workspace: string): Promise<void> {
  const frontend = path.join(workspace, 'src', 'frontend');
  await cp(path.join(DESIGN_FIXTURE, 'pages', 'clients'), path.join(frontend, 'pages', 'clients'), {
    recursive: true,
  });
  await cp(path.join(DESIGN_FIXTURE, 'app', 'partials'), path.join(frontend, 'app', 'partials'), {
    recursive: true,
  });
}

/**
 * Prepends `source` to the demo backend module and registers `clientsView`, plus any extra
 * routes the source defines.
 */
export async function addBackendModuleCode(
  workspace: string,
  source: string,
  options: { readonly routes?: readonly string[] } = {},
): Promise<void> {
  const modulePath = path.join(workspace, 'src', 'backend', 'module.ts');
  const original = await readFile(modulePath, 'utf8');
  const routes = options.routes?.length ? `[...routes, ${options.routes.join(', ')}]` : 'routes';
  const updated = original
    .replace(/^/, `import { z } from 'zod';\n\n${source}\n`)
    .replace('  routes,\n};', `  routes: ${routes},\n  views: [clientsView],\n};`);
  expect(updated).toContain('views: [clientsView]');
  await writeFile(modulePath, updated, 'utf8');
}

/** Starts the built backend and resolves once it answers `probePath`. */
export async function startBuiltBackend(
  workspace: string,
  children: Array<ReturnType<typeof Bun.spawn>>,
  probePath: string,
): Promise<string> {
  const port = await getFreePort();
  const child = Bun.spawn({
    cmd: [process.execPath, path.join(workspace, 'build', 'backend', 'index.js')],
    cwd: workspace,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
    stdout: 'ignore',
    stderr: 'ignore',
  });
  children.push(child);
  const origin = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    expect((await fetch(`${origin}${probePath}`)).status).toBeLessThan(500);
  }, 15_000);
  return origin;
}

export function cookieFrom(response: Response, fallback = ''): string {
  const header = response.headers.get('set-cookie');
  return header ? (header.split(';')[0] ?? fallback) : fallback;
}

export function csrfTokenFrom(html: string): string {
  const match = /<input type="hidden" name="_csrf" value="([^"]+)">/.exec(html);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}
