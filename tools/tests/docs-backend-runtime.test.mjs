import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('portal docs match the Bun backend scaffold split', () => {
  const firstAppDoc = read('apps/portal/docs/tutorials/first-app.md');
  const templatesDoc = read('apps/portal/docs/reference/templates.md');
  const contractsDoc = read('apps/portal/docs/reference/contracts.md');
  const devServiceDoc = read('apps/portal/docs/explanations/devservice.md');
  const workspaceDoc = read('apps/portal/docs/explanations/workspace.md');
  const fullTemplateIndex = read('orchestrators/bun/resources/templates/full/src/backend/index.ts');
  const fullTemplateModule = read(
    'orchestrators/bun/resources/templates/full/src/backend/module.ts',
  );

  assert.match(fullTemplateIndex, /createDefaultBunBackendBootstrap/);
  assert.doesNotMatch(fullTemplateIndex, /DEMO_PATH/);
  assert.match(fullTemplateModule, /const DEMO_PATH = '\/demo\/progressive-enhancement'/);

  assert.match(firstAppDoc, /That route lives in `src\/backend\/module\.ts`/);
  assert.match(firstAppDoc, /`src\/backend\/index\.ts` as a thin Bun bootstrap entry/);
  assert.doesNotMatch(firstAppDoc, /That route lives in `src\/backend\/index\.ts`/);
  assert.doesNotMatch(
    firstAppDoc,
    /editing the existing backend route in `src\/backend\/index\.ts`/,
  );

  assert.match(
    templatesDoc,
    /Fresh `api` and `full` scaffolds keep `src\/backend\/index\.ts` thin/,
  );
  assert.match(
    templatesDoc,
    /Manifest-backed route and demo logic lives in `src\/backend\/module\.ts`\./,
  );
  assert.doesNotMatch(templatesDoc, /must export an HTTP server/);
  assert.doesNotMatch(templatesDoc, /Minimal Node server/);

  assert.match(contractsDoc, /proxy to the Bun backend runtime/);
  assert.doesNotMatch(contractsDoc, /proxy to the Node server/);

  assert.match(devServiceDoc, /Bun backend runtime respects common env vars/);
  assert.doesNotMatch(devServiceDoc, /Node server respects common env vars/);

  assert.match(workspaceDoc, /thin Bun bootstrap entry/);
  assert.match(
    workspaceDoc,
    /Manifest-backed routes and scaffold demo logic live in `src\/backend\/module\.ts`\./,
  );
});
