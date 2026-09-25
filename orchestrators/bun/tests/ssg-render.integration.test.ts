import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';

import { runBuild } from '../src/build.ts';
import { runPublish } from '../src/publish.ts';
import { packageRoot } from '../src/paths.ts';
import { createSsgDevPages } from '../src/ssg-dev-pages.ts';
import {
  copyDemoWorkspace,
  removeDemoWorkspace,
  type DemoWorkspaceCopy,
} from '../test-support/demo-workspace.ts';

const copies: DemoWorkspaceCopy[] = [];

afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => removeDemoWorkspace(copy)));
});

const POST_PAGE = [
  '<head><title data-text="title">Post</title></head>',
  '<body>',
  '  <main>',
  '    <h1 data-text="title">A post</h1>',
  '    <ul><li data-each="tags as tag" data-text="tag">tag</li></ul>',
  '  </main>',
  '</body>',
  '',
].join('\n');

const VIEW_MODULE = [
  "import { z } from 'zod';",
  '',
  'const posts: Record<string, { title: string; tags: string[] }> = {',
  "  hello: { title: 'Hello <world>', tags: ['intro'] },",
  "  launch: { title: 'Launch', tags: [] },",
  '};',
  '',
  'export const module = {',
  "  manifest: { contractVersion: '1.0.0', name: 'blog', version: '1.0.0', kind: 'backend' },",
  '  views: [',
  '    {',
  "      definition: { name: 'post', path: '/blog/:slug', page: 'post', staticPaths: ['/blog/hello', '/blog/launch'] },",
  '      data: z.object({ title: z.string(), tags: z.array(z.string()) }),',
  '      load: ({ params }: { params: Record<string, string> }) => posts[params.slug],',
  '    },',
  '  ],',
  '};',
  '',
].join('\n');

/** The SSG demo with a post page and a TypeScript view module that renders it. */
async function createBlogWorkspace(): Promise<string> {
  const copy = await copyDemoWorkspace('ssg/base', 'webstir-ssg-render-');
  copies.push(copy);
  const workspace = copy.workspaceRoot;
  await mkdir(path.join(workspace, 'src', 'frontend', 'pages', 'post'), { recursive: true });
  await writeFile(
    path.join(workspace, 'src', 'frontend', 'pages', 'post', 'index.html'),
    POST_PAGE,
  );
  await mkdir(path.join(workspace, 'src', 'backend'), { recursive: true });
  await writeFile(path.join(workspace, 'src', 'backend', 'module.ts'), VIEW_MODULE);
  await mkdir(path.join(workspace, 'node_modules'), { recursive: true });
  await symlink(
    path.join(packageRoot, 'node_modules', 'zod'),
    path.join(workspace, 'node_modules', 'zod'),
  );
  return workspace;
}

test('webstir publish compiles an SSG view module and writes its pages as HTML', async () => {
  const workspace = await createBlogWorkspace();
  await runPublish({ workspaceRoot: workspace });
  const dist = path.join(workspace, 'dist', 'frontend');
  const hello = await readFile(path.join(dist, 'blog', 'hello', 'index.html'), 'utf8');
  expect(hello).toContain('<h1>Hello &lt;world&gt;</h1>');
  expect(hello).toContain('<ul><li>intro</li></ul>');
  expect(hello).not.toMatch(/data-(text|each)=/);
  expect(await readFile(path.join(dist, 'blog', 'launch', 'index.html'), 'utf8')).toContain(
    '<h1>Launch</h1>',
  );
  await expect(stat(path.join(dist, 'post', 'index.html'))).rejects.toThrow();
}, 120_000);

test('watch renders SSG pages from the build and hides the bare template', async () => {
  const workspace = await createBlogWorkspace();
  await runBuild({ workspaceRoot: workspace });
  const pages = createSsgDevPages(workspace);
  await pages.refresh();
  expect(pages.lookup('/blog/hello/')).toContain('<h1>Hello &lt;world&gt;</h1>');
  expect(pages.lookup('/post')).toBeNull();
  expect(pages.lookup('/about')).toBeUndefined();

  const modulePath = path.join(workspace, 'src', 'backend', 'module.ts');
  await writeFile(
    modulePath,
    (await readFile(modulePath, 'utf8')).replace("title: 'Launch'", "title: 'Launch day'"),
  );
  await pages.refresh();
  expect(pages.lookup('/blog/launch')).toContain('<h1>Launch day</h1>');
}, 120_000);

test('webstir build fails an SPA whose template has bindings', async () => {
  const copy = await copyDemoWorkspace('spa', 'webstir-spa-bindings-');
  copies.push(copy);
  const page = path.join(copy.workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.html');
  const html = await readFile(page, 'utf8');
  await writeFile(page, html.replace(/<main([^>]*)>/, '<main$1><p data-text="greeting">Hello</p>'));
  await expect(runBuild({ workspaceRoot: copy.workspaceRoot })).rejects.toThrow(
    /src\/frontend\/pages\/home\/index.html:\d+: page 'home' has bindings, but an SPA has no server to render them/,
  );
}, 120_000);
