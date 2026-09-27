import { afterEach, expect, test } from 'bun:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { startBunSsgFrontendWatch } from '../src/bun-ssg-watch.ts';
import {
  copyDemoWorkspace,
  removeDemoWorkspace,
  type DemoWorkspaceCopy,
} from '../test-support/demo-workspace.ts';
import { waitFor } from '../test-support/watch.ts';

const copies: DemoWorkspaceCopy[] = [];

afterEach(async () => {
  await Promise.all(copies.splice(0).map((copy) => removeDemoWorkspace(copy)));
});

test('watch builds an edit made while its first build runs', async () => {
  const copy = await copyDemoWorkspace('ssg/base', 'webstir-watch-startup-edit-');
  copies.push(copy);
  const pagePath = path.join(copy.workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.html');
  const page = await readFile(pagePath, 'utf8');
  const edited = page.replace('Welcome to your Webstir site', 'Edited while watch was starting');
  expect(edited).not.toBe(page);

  let builds = 0;
  const session = await startBunSsgFrontendWatch({
    workspaceRoot: copy.workspaceRoot,
    port: 0,
    // The first build has read the page by the time its checks run, so this edit lands after it.
    afterBuild: async () => {
      builds += 1;
      if (builds === 1) {
        await writeFile(pagePath, edited, 'utf8');
      }
    },
  });

  try {
    await waitFor(async () => {
      const html = await (await fetch(`${session.address.origin}/`)).text();
      expect(html).toContain('Edited while watch was starting');
    }, 20_000);
    expect(builds).toBe(2);
  } finally {
    await session.stop();
  }
}, 60_000);
