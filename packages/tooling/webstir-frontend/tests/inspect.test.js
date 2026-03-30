import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { inspectFrontendWorkspace } from '../dist/index.js';

async function createWorkspace({ frontendConfig, pkg, withFrontend = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-inspect-'));
  const frontendRoot = path.join(root, 'src', 'frontend');

  if (withFrontend) {
    await fs.mkdir(frontendRoot, { recursive: true });
  }

  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      pkg ?? {
        name: 'inspect-workspace',
        version: '1.0.0',
      },
      null,
      2,
    ),
    'utf8',
  );

  if (frontendConfig !== undefined) {
    await fs.writeFile(
      path.join(frontendRoot, 'frontend.config.json'),
      JSON.stringify(frontendConfig, null, 2),
      'utf8',
    );
  }

  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

test('inspectFrontendWorkspace resolves shallow workspace facts without building', async (t) => {
  const workspace = await createWorkspace({
    pkg: {
      name: 'inspect-workspace',
      version: '1.0.0',
      webstir: {
        enable: {
          clientNav: true,
          contentNav: true,
          unknownFlag: true,
        },
      },
    },
    frontendConfig: {
      paths: {
        contentRoot: 'docs/content',
      },
    },
  });

  t.after(workspace.cleanup);

  const appRoot = path.join(workspace.root, 'src', 'frontend', 'app');
  const pageRoot = path.join(workspace.root, 'src', 'frontend', 'pages', 'home');
  const contentRoot = path.join(workspace.root, 'docs', 'content');

  await fs.mkdir(appRoot, { recursive: true });
  await fs.mkdir(pageRoot, { recursive: true });
  await fs.mkdir(contentRoot, { recursive: true });

  await fs.writeFile(path.join(appRoot, 'app.html'), '<!doctype html><html></html>', 'utf8');
  await fs.writeFile(path.join(appRoot, 'app.css'), 'body{}', 'utf8');
  await fs.writeFile(path.join(appRoot, 'app.ts'), 'export {};\n', 'utf8');
  await fs.writeFile(path.join(pageRoot, 'index.html'), '<head></head><main></main>', 'utf8');
  await fs.writeFile(path.join(pageRoot, 'index.css'), 'main{}', 'utf8');
  await fs.writeFile(path.join(pageRoot, 'index.ts'), 'export {};\n', 'utf8');
  await fs.writeFile(path.join(contentRoot, '_sidebar.json'), '{}', 'utf8');

  const result = await inspectFrontendWorkspace(workspace.root);

  assert.equal(result.config.paths.src.content, contentRoot);
  assert.equal(result.packageJson.exists, true);
  assert.deepEqual(result.packageJson.enable.raw, {
    clientNav: true,
    contentNav: true,
    unknownFlag: true,
  });
  assert.deepEqual(result.packageJson.enable.known, {
    spa: false,
    clientNav: true,
    backend: false,
    search: false,
    contentNav: true,
  });

  assert.equal(result.appShell.exists, true);
  assert.equal(result.appShell.templateExists, true);
  assert.equal(result.appShell.stylesheetExists, true);
  assert.equal(result.appShell.scriptExists, true);

  assert.deepEqual(
    result.pages.map((page) => ({
      name: page.name,
      htmlExists: page.htmlExists,
      stylesheetExists: page.stylesheetExists,
      scriptExists: page.scriptExists,
    })),
    [
      {
        name: 'home',
        htmlExists: true,
        stylesheetExists: true,
        scriptExists: true,
      },
    ],
  );

  assert.equal(result.content.exists, true);
  assert.equal(result.content.sidebarOverrideExists, true);

  assert.equal(fssync.existsSync(path.join(workspace.root, 'build')), false);
  assert.equal(fssync.existsSync(path.join(workspace.root, '.webstir')), false);
});

test('inspectFrontendWorkspace reports absent frontend facts cleanly', async (t) => {
  const workspace = await createWorkspace();
  t.after(workspace.cleanup);

  const result = await inspectFrontendWorkspace(workspace.root);

  assert.equal(result.packageJson.exists, true);
  assert.equal(result.packageJson.enable.raw, undefined);
  assert.deepEqual(result.packageJson.enable.known, {
    spa: false,
    clientNav: false,
    backend: false,
    search: false,
    contentNav: false,
  });
  assert.equal(result.appShell.exists, false);
  assert.equal(result.pages.length, 0);
  assert.equal(result.content.exists, false);
  assert.equal(result.content.sidebarOverrideExists, false);
});
