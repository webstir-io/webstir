import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

import { startPublishedWorkspaceServer } from '@webstir-io/webstir-backend';

import { runBuild } from '../src/build.ts';
import { runPublish } from '../src/publish.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';
import {
  CLIENTS_DATA_SCHEMA,
  addBackendModuleCode,
  copyDesignClientsPage,
  copyFullWorkspace,
  startBuiltBackend,
} from '../test-support/render-workspace.ts';
import { removeDemoWorkspace, type DemoWorkspaceCopy } from '../test-support/demo-workspace.ts';
import {
  appendWatchLogs,
  collectOutput,
  getFreePort,
  removeTrackedChild,
  stopTrackedChildren,
  waitFor,
} from '../test-support/watch.ts';

const copies: DemoWorkspaceCopy[] = [];
const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
  await Promise.all(copies.splice(0).map((copy) => removeDemoWorkspace(copy)));
});

async function createFullWorkspaceWithClientsView(binding: string): Promise<string> {
  const workspace = await copyFullWorkspace(copies);

  const pageDir = path.join(workspace, 'src', 'frontend', 'pages', 'clients');
  await mkdir(pageDir, { recursive: true });
  await writeFile(
    path.join(pageDir, 'index.html'),
    [
      '<head><title>Clients</title></head>',
      '<main>',
      '  <ul>',
      `    <li data-each="clients as client" data-text="${binding}">Acme</li>`,
      '  </ul>',
      '  <form method="post" action="/clients/"><button type="submit">Create</button></form>',
      '</main>',
      '',
    ].join('\n'),
    'utf8',
  );

  await addBackendModuleCode(
    workspace,
    [
      'const clientsView = {',
      "  definition: { name: 'clientsPage', path: '/clients/', page: 'clients' },",
      '  data: z.object({ clients: z.array(z.object({ name: z.string(), href: z.string() })) }),',
      '  load: () => ({ clients: [] }),',
      '};',
    ].join('\n'),
  );

  return workspace;
}

test('webstir build fails with file and line when a page binds a path its view does not have', async () => {
  const workspace = await createFullWorkspaceWithClientsView('client.nmae');

  await expect(runBuild({ workspaceRoot: workspace })).rejects.toThrow(
    'src/frontend/pages/clients/index.html:4: data-text="client.nmae": `client` has no `nmae`; it has `href`, `name` (view clientsPage)',
  );
});

test('webstir build writes a render program for a page its view renders', async () => {
  const workspace = await createFullWorkspaceWithClientsView('client.name');

  await runBuild({ workspaceRoot: workspace });

  const programPath = path.join(
    workspace,
    'build',
    'frontend',
    'pages',
    'clients',
    'index.program.json',
  );
  expect((await stat(programPath)).isFile()).toBe(true);
  const program = JSON.parse(await readFile(programPath, 'utf8')) as {
    bindings: number;
    source: string;
  };
  expect(program.source).toBe('src/frontend/pages/clients/index.html');
  expect(program.bindings).toBe(2);
});

async function createDesignClientsWorkspace(): Promise<string> {
  const workspace = await copyFullWorkspace(copies);
  await copyDesignClientsPage(workspace);
  await addBackendModuleCode(
    workspace,
    [
      'const clientsView = {',
      "  definition: { name: 'clientsPage', path: '/clients/', page: 'clients' },",
      `  data: ${CLIENTS_DATA_SCHEMA},`,
      '  load: () => ({',
      "    nav: { proposals: null, clients: { current: 'page' } },",
      "    clients: [{ name: 'Acme <Logistics>', href: '/clients/acme/' }, { name: 'Birch & Co', href: '/clients/birch/' }],",
      "    create: { open: true, values: { name: 'Ne' }, issues: { name: 'Use at least two characters.' } },",
      '  }),',
      '};',
    ].join('\n'),
  );
  return workspace;
}

test('the clients page from the design renders as finished HTML from the full backend', async () => {
  const workspace = await createDesignClientsWorkspace();
  await runBuild({ workspaceRoot: workspace });
  const origin = await startBuiltBackend(workspace, childProcesses, '/clients/');
  const response = await fetch(`${origin}/clients/`);
  expect(response.status).toBe(200);
  const html = await response.text();

  expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(response.headers.get('set-cookie')).toMatch(/^webstir_session=/);
  expectDesignClientsHtml(html);
});

function expectDesignClientsHtml(html: string): void {
  expect(html).not.toMatch(/data-(text|if|each|include|attr-|webstir-src)|webstir-view-state/);
  expect(html).toContain('<a class="client-row" href="/clients/acme/">');
  expect(html).toContain('<span class="client-row-name">Acme &lt;Logistics&gt;</span>');
  expect(html).toContain('<span class="client-row-name">Birch &amp; Co</span>');
  expect(html).not.toContain('No clients yet');
  expect(html).toContain('<details class="management-panel" id="new-client" open>');
  expect(html).toContain('value="Ne"');
  expect(html).toContain('<span class="slds-error">Use at least two characters.</span>');
  expect(html).not.toContain('Something went wrong');
  expect(html).toContain('href="/clients/" aria-current="page">');
  expect(html).toContain('<title>Clients · Sqware Logics</title>');
  expect(html.match(/<input type="hidden" name="_csrf" value="[^"]+">/g)).toHaveLength(2);
}

test('webstir watch renders a view through the dev server and proxies its form posts', async () => {
  const workspace = await createDesignClientsWorkspace();
  const port = await getFreePort();
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'watch',
      '--workspace',
      workspace,
      '--port',
      String(port),
    ],
    cwd: repoRoot,
    env: { ...process.env, WEBSTIR_BACKEND_TYPECHECK: 'skip' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  childProcesses.push(child);
  const stdout = { text: '' };
  const stderr = { text: '' };
  const drains = [collectOutput(child.stdout, stdout), collectOutput(child.stderr, stderr)];
  const origin = `http://127.0.0.1:${port}`;

  try {
    await exerciseWatch(workspace, origin, stderr);
  } catch (error) {
    throw appendWatchLogs(error, stdout.text, stderr.text);
  } finally {
    child.kill('SIGTERM');
    await child.exited.catch(() => undefined);
    await Promise.allSettled(drains);
    removeTrackedChild(childProcesses, child);
  }
}, 90_000);

async function exerciseWatch(
  workspace: string,
  origin: string,
  stderr: { text: string },
): Promise<void> {
  let html = '';
  await waitFor(async () => {
    const response = await fetch(`${origin}/clients/`);
    expect(response.status).toBe(200);
    html = await response.text();
    expect(html).toContain('client-row-name');
  }, 45_000);
  expectDesignClientsHtml(html);
  expect(html).toContain('/refresh.js');

  const post = await fetch(`${origin}/clients/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Acme',
    redirect: 'manual',
  });
  expect(post.status).toBe(404);
  expect(await post.json()).toMatchObject({ error: 'not_found' });

  const pagePath = path.join(workspace, 'src', 'frontend', 'pages', 'clients', 'index.html');
  const page = await readFile(pagePath, 'utf8');
  await writeFile(
    pagePath,
    page.replace(
      '<h1 class="slds-page-title">Clients</h1>',
      '<h1 class="slds-page-title">All clients</h1>',
    ),
    'utf8',
  );
  await waitFor(async () => {
    expect(await (await fetch(`${origin}/clients/`)).text()).toContain('All clients</h1>');
  }, 20_000);

  const current = await readFile(pagePath, 'utf8');
  await writeFile(
    pagePath,
    current.replace('data-text="client.name"', 'data-text="client.nmae"'),
    'utf8',
  );
  await waitFor(async () => {
    expect(stderr.text).toContain(
      'src/frontend/pages/clients/index.html:16: data-text="client.nmae": `client` has no `nmae`',
    );
  }, 20_000);
}

test('the published server renders views and keeps programs private', async () => {
  const workspace = await createDesignClientsWorkspace();
  await runPublish({ workspaceRoot: workspace });

  const server = await startPublishedWorkspaceServer({
    workspaceRoot: workspace,
    port: await getFreePort(),
    host: '127.0.0.1',
    io: { stdout: { write: () => true }, stderr: { write: () => true } },
  });
  try {
    const response = await fetch(`${server.origin}/clients/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expectDesignClientsHtml(html);
    expect(html).not.toContain('/refresh.js');

    for (const spelling of [
      '/pages/clients/index.program.json',
      '/pages/clients/index%2eprogram%2ejson',
      '/pages/clients/index.program.json/',
    ]) {
      expect((await fetch(`${server.origin}${spelling}`)).status, spelling).toBe(404);
    }

    const home = await fetch(`${server.origin}/`);
    expect(home.status).toBe(200);
    expect(await home.text()).not.toContain('client-row-name');
  } finally {
    await server.stop();
  }
}, 60_000);
